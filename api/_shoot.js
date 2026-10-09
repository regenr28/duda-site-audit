// Takes a full-page picture of one page of a website, the way a visitor's browser would draw it,
// and lists where every piece of text, image and button sits on it.
//
// A real Chrome is started for each picture and driven directly over its own debugging pipe, so
// there is no browser-automation library in between: on Vercel the Chrome comes from the
// @sparticuz/chromium package (the only dependency this needs); locally CAPTURE_CHROME_PATH can
// point at any Chrome or Chromium.
//
// The page is drawn at the device's real width (desktop 1920 × 1000), scrolled once top to bottom
// so pictures that load late and sections that fade in on scroll have appeared, then photographed
// in slices without resizing the window — resizing would stretch anything sized to the screen
// height, like a full-screen header.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEVICES = {
  desktop: { w: 1920, h: 1000, dsf: 1, mobile: false, slice: 2000,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' },
  tablet: { w: 820, h: 1180, dsf: 1.5, mobile: true, slice: 1600,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  mobile: { w: 390, h: 844, dsf: 2, mobile: true, slice: 1400,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
};
export const MAX_HEIGHT = 16000;   // CSS pixels; anything longer is cut, and the picture says so

async function chromePath() {
  if (process.env.CAPTURE_CHROME_PATH) {
    return { exe: process.env.CAPTURE_CHROME_PATH, args: ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'] };
  }
  let mod;
  try { mod = await import('@sparticuz/chromium'); } catch (e) { throw new Error('Page pictures are not set up on this server yet (the Chromium package is missing).'); }
  const c = mod.default || mod;
  try { if ('setGraphicsMode' in c) c.setGraphicsMode = false; } catch (e) { /* older versions */ }
  const exe = await c.executablePath();
  // Not wanted for taking a picture of one of our own pages.
  const args = (c.args || []).filter((a) => !/^--(remote-debugging|user-data-dir|window-size|disable-web-security|allow-running-insecure-content)/.test(a));
  if (!args.some((a) => a.startsWith('--headless'))) args.push('--headless');
  // Vercel has no /dev/shm (shared memory), which Chrome uses by default and stops without; this
  // makes it use the ordinary temp folder instead.
  if (!args.includes('--disable-dev-shm-usage')) args.push('--disable-dev-shm-usage');
  return { exe, args };
}

/** A minimal Chrome DevTools Protocol client over --remote-debugging-pipe (messages end with \0). */
class Pipe {
  constructor(proc) {
    this.proc = proc; this.n = 0; this.wait = new Map(); this.subs = new Set(); this.dead = null;
    this.out = proc.stdio[3]; const inp = proc.stdio[4];
    let parts = [];
    inp.on('data', (buf) => {
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) continue;
        parts.push(buf.subarray(start, i));
        const msg = Buffer.concat(parts).toString('utf8'); parts = []; start = i + 1;
        let m; try { m = JSON.parse(msg); } catch (e) { continue; }
        if (m.id && this.wait.has(m.id)) {
          const w = this.wait.get(m.id); this.wait.delete(m.id);
          if (m.error) w.no(new Error(w.method + ': ' + (m.error.message || 'failed'))); else w.ok(m.result || {});
        } else if (m.method) this.subs.forEach((f) => f(m));
      }
      if (start < buf.length) parts.push(buf.subarray(start));
    });
    const fail = (why) => { if (this.dead) return; this.dead = why; this.wait.forEach((w) => w.no(new Error(why))); this.wait.clear(); };
    proc.on('exit', () => fail('The page browser stopped unexpectedly.'));
    proc.on('error', (e) => fail('The page browser could not start: ' + e.message));
    inp.on('error', () => {}); this.out.on('error', () => {});
  }
  send(method, params = {}, sessionId) {
    if (this.dead) return Promise.reject(new Error(this.dead));
    const id = ++this.n;
    return new Promise((ok, no) => {
      this.wait.set(id, { ok, no, method });
      this.out.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
    });
  }
  on(f) { this.subs.add(f); return () => this.subs.delete(f); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, label) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(label || 'Timed out')), ms))]);

/** Runs in the page: scroll through once so late pictures and scroll-in sections appear. */
const SETTLE = `(async (MAX) => {
  const H = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
  const step = Math.max(300, Math.round(innerHeight * 0.75));
  for (let y = 0, i = 0; i < 80 && y < Math.min(H(), MAX); i++) { y += step; scrollTo(0, y); await new Promise((r) => setTimeout(r, 110)); }
  scrollTo(0, H()); await new Promise((r) => setTimeout(r, 300));
  scrollTo(0, 0); await new Promise((r) => setTimeout(r, 500));
  const pending = [...document.images].filter((i) => !i.complete);
  await Promise.race([Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), new Promise((r) => setTimeout(r, 4000))]);
  try { await document.fonts.ready; } catch (e) {}
  await new Promise((r) => setTimeout(r, 900));
  scrollTo(0, 0);
  return H();
})`;

/**
 * Runs in the page: every piece of text, every picture, link and button, with where it sits.
 * The address of each (a CSS selector) is built from the nearest element with a unique id, which
 * Duda gives to every widget and keeps across edits, so the same element can be found again later.
 */
const MAP = `((MAX, SITE) => {
  const sx = scrollX, sy = scrollY, out = [];
  const idOk = (e) => e.id && /^[A-Za-z0-9_-]+$/.test(e.id) && document.querySelectorAll('[id="' + e.id + '"]').length === 1;
  const sel = (el) => {
    const parts = []; let e = el;
    while (e && e.nodeType === 1 && e !== document.documentElement) {
      if (idOk(e)) { parts.unshift(/^\\d/.test(e.id) ? '[id="' + e.id + '"]' : '#' + e.id); break; }
      let i = 1, s = e; while ((s = s.previousElementSibling)) if (s.tagName === e.tagName) i++;
      parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); e = e.parentElement;
    }
    return parts.join(' > ');
  };
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|HEAD|META|LINK|TEMPLATE|PATH|G|DEFS|USE|BR|HR|SOURCE|TRACK|OPTION)$/i;
  for (const el of document.body.querySelectorAll('*')) {
    if (out.length >= 3500) break;
    if (SKIP.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.top + sy > MAX || r.bottom + sy < 0) continue;
    const tag = el.tagName;
    let own = ''; for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.replace(/\\s+/g, ' ').trim();
    let k = '';
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'svg') k = 'img';
    else if (tag === 'A' || tag === 'BUTTON') k = 'link';
    else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') k = 'field';
    else if (own.length > 1) k = 'text';
    else if (/^(H[1-6]|P|LI|UL|OL|SECTION|FORM|TABLE|IFRAME)$/.test(tag)) k = 'box';
    else if (r.width > 80 && r.height > 50) { const bg = getComputedStyle(el).backgroundImage; if (bg && bg !== 'none' && /url\\(/.test(bg)) k = 'img'; else if (el.id && /^\\d+$/.test(el.id)) k = 'box'; }
    if (!k) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
    const t = k === 'img' ? (el.getAttribute('alt') || el.getAttribute('title') || '') : k === 'field' ? (el.getAttribute('placeholder') || el.name || '') : (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const o = { r: [Math.round(r.left + sx), Math.round(r.top + sy), Math.round(r.width), Math.round(r.height)], k, t: t.slice(0, 400), s: sel(el) };
    if (tag === 'A' && el.getAttribute('href')) o.h = el.getAttribute('href').slice(0, 300);
    out.push(o);
  }
  // Pages of the same website, for the page picker. The preview's own links look like
  // /site/<id>/about?preview=true…; the published site's are plain /about.
  const links = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    let u; try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    let p = u.pathname;
    const m = p.match(/^\\/site\\/[A-Za-z0-9_-]+(\\/.*)?$/);
    if (m) p = m[1] || '/';
    else if (u.host !== location.host) continue;
    p = p.replace(/\\/+$/, '') || '/';
    if (!/^\\/[\\w\\-/.%~]*$/.test(p) || p.includes('..') || /\\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)$/i.test(p) || seen.has(p)) continue;
    seen.add(p);
    links.push({ p, t: (a.innerText || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) });
    if (links.length >= 80) break;
  }
  return { els: out, links, title: document.title.slice(0, 200) };
})`;

/**
 * Photograph one page. Returns { w, h, dsf, full, slices: [{ y, h, data(base64 webp) }], els, links, title, ms }.
 * `url` is fetched exactly as given; callers decide which addresses are allowed.
 */
/** Runs in the page: bring one element into view and say where its middle is on the screen. */
const LOCATE = `((s, scroll) => {
  let el = null; try { el = document.querySelector(s); } catch (e) { return null; }
  if (!el) return null;
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
  return { x, y };
})`;

/**
 * Photograph one page. Returns { w, h, dsf, full, slices: [{ y, h, data(base64 webp) }], els, links, title, ms }.
 * `url` is fetched exactly as given; callers decide which addresses are allowed.
 *
 * `replay` puts the page back the way a client had it while browsing: the clicks they made (a menu,
 * a pop-up, a slider arrow) are made again as real mouse clicks, the page is scrolled to where they
 * were, and the pointer is put back over what it was over — so the picture shows what they saw.
 */
export async function shoot(url, device = 'desktop', { timeout = 85000, replay = null } = {}) {
  const D = DEVICES[device];
  if (!D) throw new Error('Unknown device');
  const t0 = Date.now();
  const { exe, args } = await chromePath();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const proc = spawn(exe, [...args, '--remote-debugging-pipe', '--hide-scrollbars', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', `--user-data-dir=${prof}`,
    `--window-size=${D.w},${D.h}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: process.env });
  let errText = ''; proc.stdio[2].on('data', (d) => { if (errText.length < 2000) errText += d.toString(); });
  const cdp = new Pipe(proc);
  const killAll = () => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* tmp */ } };
  const deadline = setTimeout(killAll, timeout + 5000);
  try {
    const { targetId } = await within(cdp.send('Target.createTarget', { url: 'about:blank' }), 20000, 'The page browser did not start in time.' + (errText ? ' ' + errText.slice(0, 200) : ''));
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (m, p) => cdp.send(m, p, s);
    await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: D.w, height: D.h, deviceScaleFactor: D.dsf, mobile: D.mobile });
    if (D.mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});
    await call('Network.setUserAgentOverride', { userAgent: D.ua });
    // Count requests in flight, to wait until the page has stopped loading.
    let inflight = 0, lastNet = Date.now(), loaded = false, status = 0;
    const ids = new Set();
    cdp.on((m) => {
      if (m.sessionId !== s) return;
      if (m.method === 'Network.requestWillBeSent') { ids.add(m.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') { ids.delete(m.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (m.method === 'Network.responseReceived' && m.params.type === 'Document' && !status) status = m.params.response.status;
      else if (m.method === 'Page.loadEventFired') loaded = true;
    });
    const nav = await call('Page.navigate', { url });
    if (nav.errorText) throw new Error('The page could not be opened (' + nav.errorText + ').');
    const quiet = async (maxMs, need) => {
      const end = Date.now() + maxMs;
      while (Date.now() < end) {
        if ((loaded || need === 0) && inflight <= 2 && Date.now() - lastNet > 700) return;
        await sleep(150);
      }
    };
    await quiet(Math.min(30000, timeout / 3));
    if (status >= 400) throw new Error(`The page answered with an error (${status}).`);
    const ev = async (fn, ...a) => {
      const r = await call('Runtime.evaluate', { expression: `(${fn})(${a.map((x) => JSON.stringify(x)).join(',')})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('The page could not be read: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 160));
      return r.result.value;
    };
    const fullH = await within(ev(SETTLE, MAX_HEIGHT), 30000, 'The page took too long to finish drawing.');
    await quiet(6000, 0);
    let scrollY = 0;
    if (replay) {
      const mouse = async (type, p) => call('Input.dispatchMouseEvent', Object.assign({ type, x: p.x, y: p.y }, type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }));
      for (const a of (replay.actions || []).slice(-20)) {
        const p = await ev(LOCATE, String(a.s || ''), true).catch(() => null);
        if (!p) continue;
        await sleep(150);
        await mouse('mouseMoved', p); await mouse('mousePressed', p); await mouse('mouseReleased', p);
        await sleep(650);
      }
      scrollY = Math.max(0, Math.min(MAX_HEIGHT, Math.round(Number(replay.y) || 0)));
      await ev('((y) => { scrollTo(0, y); })', scrollY);
      await sleep(450);
      scrollY = await ev('(() => scrollY)');
      if (replay.hover) {
        const p = await ev(LOCATE, String(replay.hover), false).catch(() => null);
        if (p) { await mouse('mouseMoved', p); await sleep(600); }
      }
      await quiet(3000, 0);
    }
    const h = Math.max(D.h, Math.min(Math.ceil(fullH || D.h), MAX_HEIGHT));
    const map = await ev(MAP, h, '');
    const slices = [];
    for (let y = 0; y < h; y += D.slice) {
      const sh = Math.min(D.slice, h - y);
      const r = await within(call('Page.captureScreenshot', { format: 'webp', quality: 72, captureBeyondViewport: true, fromSurface: true,
        clip: { x: 0, y, width: D.w, height: sh, scale: 1 } }), 30000, 'Taking the picture took too long.');
      slices.push({ y, h: sh, data: r.data });
    }
    return { w: D.w, h, dsf: D.dsf, full: Math.ceil(fullH || h), cut: (fullH || 0) > MAX_HEIGHT, slices, els: map.els || [], links: map.links || [], title: map.title || '', status, scrollY, ms: Date.now() - t0 };
  } catch (e) {
    // When Chrome itself dies, what it printed on the way out is the only clue — keep the end of it.
    if (/browser (stopped|could not start|did not start)/.test(String(e.message)) && errText.trim()) {
      e.message = `${e.message} (${errText.trim().split('\n').slice(-3).join(' | ').slice(0, 400)})`;
    }
    throw e;
  } finally {
    clearTimeout(deadline);
    try { await within(cdp.send('Browser.close'), 2000); } catch (e) { /* kill below */ }
    killAll();
  }
}
