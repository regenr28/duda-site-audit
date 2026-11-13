// Proof pictures: a small cropped picture of the problem, with a red box around it, taken while the
// problem is still on the page — so when someone says "that was never there", the dated picture says
// it was. One Chrome per page; every item on that page is pictured in turn.
//
// Small on purpose: the part of the page around the element, at most 900 px wide, WebP — about
// 20–40 KB each, never the whole page. Items in the page's <head> (SEO title, meta description) have
// no picture to take: their proof is the line of code itself, which is kept for every item.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVICES, chromePath, Pipe, sleep, within, SETTLE } from './_shoot.js';

/** Runs in the page: where the element is, its code, and draws (or removes) the red box. */
const FIND = `((sel) => {
  let el = null; try { el = document.querySelector(sel); } catch (e) { return { why: 'The element could not be found (the page has changed)' }; }
  if (!el) return { why: 'The element is not on the page any more' };
  const code = (el.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 700);
  if (el.closest('head')) return { code, head: true };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { code, why: 'The element is hidden on this device' };
  const box = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  const o = document.createElement('div'); o.id = '__dsa_proof';
  o.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;border:4px solid #e11d48;border-radius:4px;box-shadow:0 0 0 3px rgba(255,255,255,.85);' +
    'left:' + (box.x - 6) + 'px;top:' + (box.y - 6) + 'px;width:' + (box.w + 4) + 'px;height:' + (box.h + 4) + 'px';
  document.documentElement.appendChild(o);
  return { code, box, pageW: document.documentElement.scrollWidth, pageH: document.documentElement.scrollHeight };
})`;
const CLEAR = `(() => { const o = document.getElementById('__dsa_proof'); if (o) o.remove(); return true; })`;

/**
 * Picture each target on one page. targets: [{ id, selector }]. Returns { shots: [{ id, img?(base64 webp), w, h, code, why? }] }.
 */
export async function proofShots(url, device = 'desktop', targets = [], { timeout = 90000 } = {}) {
  const D0 = DEVICES[device]; if (!D0) throw new Error('Unknown device');
  const D = Object.assign({}, D0, { dsf: 1 });
  const { exe, args } = await chromePath();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'prf-'));
  const proc = spawn(exe, [...args, '--remote-debugging-pipe', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', `--user-data-dir=${prof}`, `--window-size=${D.w},${D.h}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: process.env });
  const cdp = new Pipe(proc);
  const killAll = () => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* tmp */ } };
  const deadline = setTimeout(killAll, timeout + 5000);
  try {
    const { targetId } = await within(cdp.send('Target.createTarget', { url: 'about:blank' }), 20000, 'The page browser did not start in time.');
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (m, p) => cdp.send(m, p, s);
    await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: D.w, height: D.h, deviceScaleFactor: 1, mobile: D.mobile });
    await call('Network.setUserAgentOverride', { userAgent: D.ua });
    let inflight = 0, lastNet = Date.now(), loaded = false, status = 0; const ids = new Set();
    cdp.on((m) => {
      if (m.sessionId !== s) return;
      if (m.method === 'Network.requestWillBeSent') { ids.add(m.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') { ids.delete(m.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (m.method === 'Network.responseReceived' && m.params.type === 'Document' && !status) status = m.params.response.status;
      else if (m.method === 'Page.loadEventFired') loaded = true;
    });
    const nav = await call('Page.navigate', { url });
    if (nav.errorText) throw new Error('The page could not be opened (' + nav.errorText + ').');
    const quiet = async (maxMs, need) => { const end = Date.now() + maxMs; while (Date.now() < end) { if ((loaded || need === 0) && inflight <= 2 && Date.now() - lastNet > 700) return; await sleep(150); } };
    await quiet(Math.min(30000, timeout / 3));
    if (status >= 400) throw new Error(`The page answered with an error (${status}).`);
    const ev = async (fn, ...a) => {
      const r = await call('Runtime.evaluate', { expression: `(${fn})(${a.map((x) => JSON.stringify(x)).join(',')})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('The page could not be read.');
      return r.result.value;
    };
    await within(ev(SETTLE, 12000), 30000, 'The page took too long to finish drawing.');
    await quiet(3000, 0);
    const shots = [];
    for (const t of targets.slice(0, 30)) {
      const f = await ev(FIND, String(t.selector || '')).catch(() => ({ why: 'The element could not be found' }));
      if (!f || !f.box) { shots.push({ id: t.id, code: (f && f.code) || '', why: (f && f.why) || '', head: !!(f && f.head) }); continue; }
      await sleep(200);
      // The element and some of the page around it, so it is clear where on the page it is.
      const b = f.box; const padX = Math.max(80, b.w * 0.4), padY = Math.max(70, b.h * 0.6);
      const W = Math.min(D.w, Math.max(Math.min(D.w, 600), b.w + padX * 2)), H = Math.min(900, Math.max(260, b.h + padY * 2));
      const x = Math.max(0, Math.min((f.pageW || D.w) - W, b.x + b.w / 2 - W / 2)), y = Math.max(0, Math.min((f.pageH || H) - H, b.y + b.h / 2 - H / 2));
      const k = Math.min(1, 900 / W);
      const r = await within(call('Page.captureScreenshot', { format: 'webp', quality: 70, captureBeyondViewport: true, fromSurface: true, clip: { x, y, width: W, height: H, scale: k } }), 20000, 'Taking the picture took too long.');
      await ev(CLEAR).catch(() => {});
      shots.push({ id: t.id, img: r.data, w: Math.round(W * k), h: Math.round(H * k), code: f.code });
    }
    return { shots, status };
  } finally {
    clearTimeout(deadline);
    try { await within(cdp.send('Browser.close'), 2000); } catch (e) { /* kill below */ }
    killAll();
  }
}
