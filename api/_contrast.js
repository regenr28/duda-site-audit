// Colour contrast, measured the way a visitor sees the page (WCAG 2.2, 1.4.3 and 1.4.11).
//
// Reading colours from the code is not enough on a Duda website: text often sits in a wrapper with no
// background of its own, over a section whose background is a photo, a gradient, a video or a
// coloured overlay layer that is a SIBLING of the text, not its parent. So the page is drawn in a
// real Chrome and the background is looked at, not guessed:
//
//   1. Every piece of visible text, every button and link, and every form field is listed with its
//      colour, size and exact position (the text's own line boxes, not the whole block).
//   2. Every form field is typed into ("Sample text"), so the colour of typed text is the one used.
//   3. All text is made transparent (placeholders and typed text too) and the page is photographed.
//      What is left behind each piece of text is exactly what the text is drawn on: the colour, the
//      image, the gradient and any overlay, whatever element they belong to.
//   4. The pixels behind each piece are measured: the typical background (median), and the lightest
//      and darkest parts (10th and 90th percentile) for text over a photo or gradient.
//
// Requirements (WCAG AA): normal text 4.5:1, large text (24px, or 18.66px bold) 3:1. Placeholder text
// is text, so 4.5:1 too. A form field's edge (border, or its fill against what is around it) 3:1.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEVICES, chromePath, Pipe, sleep, within, SETTLE } from './_shoot.js';

const MAX_H = 12000;           // CSS pixels of page measured
const MAX_ITEMS = 700;         // pieces of text per page

/** Runs in the page: list what to measure. */
const COLLECT = `((MAXH, MAXN) => {
  const out = [];
  const sx = scrollX, sy = scrollY;
  const rgba = (c) => { const m = String(c || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const sel = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\\w-]*$/.test(e.id) && document.querySelectorAll('#' + e.id).length === 1) { parts.unshift('#' + e.id); break; }
      let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
      parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      if (parts.length > 7) break;
    }
    return parts.join(' > ');
  };
  const where = (el) => { for (let e = el; e; e = e.parentElement) { const c = String(e.className || '') + ' ' + (e.id || ''); if (/\\b(dmHeader|hcontainer|hamburger-header)\\b/.test(c)) return 'Header'; if (/\\b(dmFooter|fcontainer|dmFooterContainer)\\b/.test(c)) return 'Footer'; if (/\\b(dmPopup|popup)\\b/i.test(c)) return 'Popup'; } return 'Body'; };
  // How see-through an element is, all its parents included; null when it is not shown at all.
  const shown = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse') return null;
      o *= parseFloat(c.opacity || '1');
      if (o < 0.08) return null;
    }
    return o;
  };
  const box = (r) => ({ x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) });
  const kindOf = (el) => (el.closest('button, [role=button], .dmButtonLink, .dmWidget, a.button, .btn') ? 'button' : el.closest('a[href]') ? 'link' : 'text');
  // Form fields: typed into, so the colour of what a visitor types is the one measured.
  const fields = [...document.querySelectorAll('input, textarea, select')].filter((f) => {
    const t = (f.getAttribute('type') || 'text').toLowerCase();
    return f.tagName !== 'INPUT' || ['text', 'email', 'tel', 'number', 'search', 'url', 'password', ''].includes(t);
  });
  fields.forEach((f) => {
    if (out.length >= MAXN || f.disabled || f.getAttribute('aria-hidden') === 'true') return;
    const o = shown(f); if (o === null) return;
    const r = f.getBoundingClientRect(); if (r.width < 20 || r.height < 12 || r.top + sy > MAXH) return;
    const c = getComputedStyle(f);
    const pad = (k) => parseFloat(c[k]) || 0;
    const inner = { x: r.left + sx + pad('borderLeftWidth') + pad('paddingLeft'), y: r.top + sy + pad('borderTopWidth') + pad('paddingTop'),
      w: r.width - pad('borderLeftWidth') - pad('borderRightWidth') - pad('paddingLeft') - pad('paddingRight'), h: r.height - pad('borderTopWidth') - pad('borderBottomWidth') - pad('paddingTop') - pad('paddingBottom') };
    if (inner.w < 8 || inner.h < 6) { inner.x = r.left + sx + 2; inner.y = r.top + sy + 2; inner.w = r.width - 4; inner.h = r.height - 4; }
    // Its name as a visitor reads it: its label, or the words just above it.
    let near = ''; for (let e = f.previousElementSibling, k = 0; e && k < 3 && !near; e = e.previousElementSibling, k++) { const t = (e.innerText || '').trim(); if (t && t.length <= 60 && !e.matches('input, textarea, select')) near = t; }
    if (!near && f.parentElement) { const t = (f.parentElement.innerText || '').trim(); if (t && t.length <= 60) near = t; }
    const label = (f.labels && f.labels[0] && f.labels[0].innerText) || f.getAttribute('aria-label') || f.getAttribute('placeholder') || near || f.getAttribute('name') || 'form';
    const base = { sel: sel(f), where: where(f), field: label.trim().slice(0, 60), size: parseFloat(c.fontSize) || 16, weight: parseInt(c.fontWeight, 10) || 400, op: o,
      box: { x: Math.round(inner.x), y: Math.round(inner.y), w: Math.round(inner.w), h: Math.round(inner.h) }, outer: box(r) };
    const ph = f.getAttribute('placeholder');
    if (ph && !f.value && f.tagName !== 'SELECT') out.push(Object.assign({ kind: 'placeholder', text: ph.slice(0, 80), color: rgba(getComputedStyle(f, '::placeholder').color) }, base));
    const bw = Math.max(pad('borderTopWidth'), pad('borderBottomWidth'), pad('borderLeftWidth'));
    out.push(Object.assign({ kind: 'field', text: 'Sample text', color: rgba(c.color), border: bw >= 1 ? rgba(c.borderBottomColor || c.borderTopColor) : null, borderW: bw }, base));
    if (f.tagName !== 'SELECT' && !f.value) { try { f.value = 'Sample text'; f.dataset.dsaTyped = '1'; } catch (e) { /* read-only */ } }
  });
  // Text: every element with words of its own, measured where its words are drawn.
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode()) && out.length < MAXN) {
    const t = n.nodeValue.replace(/\\s+/g, ' ').trim();
    if (t.length < 2 || !/[\\p{L}\\p{N}]/u.test(t) || /^[\\uE000-\\uF8FF\\s]+$/.test(t)) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('script, style, noscript, svg, template, iframe, input, textarea, select, option, [aria-hidden="true"]')) continue;
    seen.add(el);
    const o = shown(el); if (o === null) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 6);
    if (!rects.length) continue;
    // Text pushed off the screen or clipped to a pixel is for screen readers only.
    const r0 = rects[0];
    if (r0.right < 0 || r0.left > innerWidth || r0.top + sy > MAXH) continue;
    const cl = el.closest('[class*="sr-only"], [class*="visually-hidden"], .screen-reader-text'); if (cl) continue;
    const c = getComputedStyle(el);
    const col = rgba(c.webkitTextFillColor && c.webkitTextFillColor !== c.color && !/rgba\\(0, 0, 0, 0\\)/.test(c.webkitTextFillColor) ? c.webkitTextFillColor : c.color);
    if (!col || col[3] === 0) continue;
    out.push({ kind: kindOf(el), text: t.slice(0, 90), color: col, size: parseFloat(c.fontSize) || 16, weight: parseInt(c.fontWeight, 10) || 400, op: o,
      sel: sel(el), where: where(el), shadow: c.textShadow && c.textShadow !== 'none',
      boxes: rects.slice(0, 6).map(box) });
  }
  return { items: out, h: Math.min(MAXH, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)) };
})`;

/** Runs in the page: hide every piece of text (and put it back). */
const HIDE = `((on) => {
  let st = document.getElementById('__dsa_hide');
  if (!on) { if (st) st.remove(); return true; }
  if (!st) { st = document.createElement('style'); st.id = '__dsa_hide'; document.documentElement.appendChild(st); }
  st.textContent = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; }'
    + ' ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
    + ' ::selection { background: transparent !important; } *:focus { outline: none !important; }';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  return true;
})`;

/** Runs in the page: given one photographed strip, measure the pixels behind each box on it. */
const MEASURE = `(async (png, y0, w, h, jobs) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + png;
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const out = {};
  for (const j of jobs) {
    const L = []; let R = 0, G = 0, B = 0;
    for (const b of j.boxes) {
      const x0 = Math.max(0, Math.round(b.x)), x1 = Math.min(w, Math.round(b.x + b.w));
      const ya = Math.max(0, Math.round(b.y - y0)), yb = Math.min(h, Math.round(b.y + b.h - y0));
      if (x1 - x0 < 1 || yb - ya < 1) continue;
      const d = g.getImageData(x0, ya, x1 - x0, yb - ya).data;
      const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (yb - ya)) / 900)));
      for (let yy = 0; yy < yb - ya; yy += step) for (let xx = 0; xx < x1 - x0; xx += step) {
        const k = (yy * (x1 - x0) + xx) * 4;
        const r = d[k], gg = d[k + 1], bb = d[k + 2];
        L.push(0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb)); R += r; G += gg; B += bb;
      }
    }
    if (!L.length) continue;
    L.sort((a, b) => a - b);
    const q = (p) => L[Math.min(L.length - 1, Math.floor(p * (L.length - 1)))];
    out[j.id] = { n: L.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), min: L[0], max: L[L.length - 1], rgb: [R / L.length, G / L.length, B / L.length] };
  }
  return out;
})`;

// ---------- the arithmetic (WCAG 2.x) ----------
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const blend = (fg, a, bg) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const r1 = (x) => (Math.floor(x * 10) / 10).toFixed(1);

/**
 * Turn measurements into audit items. Only failures are returned.
 * `m` maps job id → background stats; text jobs are `t<i>`, a field's surroundings `o<i>`.
 */
export function judge(items, m, device) {
  const out = [];
  items.forEach((it, i) => {
    const bg = m['t' + i]; if (!bg || !it.color) return;
    const a = Math.max(0, Math.min(1, (it.color[3] === undefined ? 1 : it.color[3]) * (it.op || 1)));
    const fg = blend(it.color, a, bg.rgb);
    const Lt = lum(fg);
    const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = large ? 3 : 4.5;
    const typical = ratio(Lt, bg.p50);
    // The worst of the lighter and darker parts behind it: for text over a photo or a gradient.
    const worst = Math.min(ratio(Lt, bg.p10), ratio(Lt, bg.p90));
    const varied = bg.p90 - bg.p10 > 0.08;
    const base = { device, selector: it.sel, location: it.where, path: '', visible: true, hiddenBy: '', snippet: '', contrast: { fg: hex(fg), bg: hex(bg.rgb), ratio: +r1(typical), worst: +r1(worst), need, large, image: varied } };
    if (it.kind === 'field') {
      if (typical < need) out.push(Object.assign(base, { code: 'CONTRAST_FIELD_TEXT', severity: 'warning', category: 'Accessibility',
        message: `Text typed into the "${it.field}" field is hard to read: contrast ${r1(typical)}:1, needs ${need}:1`, found: `${hex(fg)} on ${hex(bg.rgb)} (${r1(typical)}:1)`, expected: `At least ${need}:1 (WCAG AA)` }));
      // The field's edge: its border, or its fill against what is around it, has to stand out (3:1).
      const around = m['o' + i];
      if (around) {
        const fill = ratio(bg.p50, around.p50);
        const edge = it.border && it.border[3] > 0.1 ? ratio(lum(blend(it.border, it.border[3], around.rgb)), around.p50) : 0;
        if (Math.max(fill, edge) < 3) out.push(Object.assign({}, base, { code: 'CONTRAST_FIELD_EDGE', severity: 'warning', category: 'Accessibility',
          message: `The "${it.field}" field is hard to see: its ${it.border ? 'border' : 'edge'} has ${r1(Math.max(fill, edge))}:1 contrast with what is around it, needs 3:1`,
          found: `${it.border ? hex(it.border) + ' border' : hex(bg.rgb) + ' field'} on ${hex(around.rgb)} (${r1(Math.max(fill, edge))}:1)`, expected: 'At least 3:1 (WCAG 1.4.11)',
          contrast: Object.assign({}, base.contrast, { fg: it.border ? hex(it.border) : hex(bg.rgb), bg: hex(around.rgb), ratio: +r1(Math.max(fill, edge)), need: 3, edge: true }) }));
      }
      return;
    }
    if (it.kind === 'placeholder') {
      if (typical < 4.5) out.push(Object.assign(base, { code: 'CONTRAST_PLACEHOLDER', severity: 'warning', category: 'Accessibility',
        message: `Placeholder "${it.text}" in a form is hard to read: contrast ${r1(typical)}:1, needs 4.5:1`, found: `${hex(fg)} on ${hex(bg.rgb)} (${r1(typical)}:1)`, expected: 'At least 4.5:1 (WCAG AA): darker or lighter placeholder text' }));
      return;
    }
    const what = it.kind === 'button' ? 'Button text' : it.kind === 'link' ? 'Link text' : 'Text';
    if (typical < need) {
      out.push(Object.assign(base, { code: varied ? 'CONTRAST_IMAGE' : 'CONTRAST_TEXT', severity: 'warning', category: 'Accessibility',
        message: `${what} is hard to read${varied ? ' over the background image or gradient' : ''}: contrast ${r1(typical)}:1, needs ${need}:1${large ? ' (large text)' : ''}`,
        found: it.text, expected: `${hex(fg)} on ${varied ? 'about ' : ''}${hex(bg.rgb)}: at least ${need}:1 (WCAG AA)` }));
    } else if (varied && worst < need && !it.shadow) {
      // Fine over most of the picture, not over its lightest or darkest part.
      out.push(Object.assign(base, { code: 'CONTRAST_IMAGE', severity: 'info', category: 'Accessibility',
        message: `${what} over a background image or gradient is hard to read in places: ${r1(worst)}:1 over its ${ratio(Lt, bg.p10) < ratio(Lt, bg.p90) ? 'darkest' : 'lightest'} part (${r1(typical)}:1 on average), needs ${need}:1`,
        found: it.text, expected: 'A darker overlay behind the text, a text shadow, or a solid panel' }));
    }
  });
  return out;
}

/** Open one page, measure everything, return failing items. */
export async function contrastScan(url, device = 'desktop', { timeout = 90000 } = {}) {
  const D0 = DEVICES[device]; if (!D0) throw new Error('Unknown device');
  const D = Object.assign({}, D0, { dsf: 1 });   // one picture pixel per CSS pixel: what is measured is the page, not the screen
  const t0 = Date.now();
  const { exe, args } = await chromePath();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-'));
  const proc = spawn(exe, [...args, '--remote-debugging-pipe', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', `--user-data-dir=${prof}`, `--window-size=${D.w},${D.h}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: process.env });
  let errText = ''; proc.stdio[2].on('data', (d) => { if (errText.length < 2000) errText += d.toString(); });
  const cdp = new Pipe(proc);
  const killAll = () => { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* tmp */ } };
  const deadline = setTimeout(killAll, timeout + 5000);
  try {
    const { targetId } = await within(cdp.send('Target.createTarget', { url: 'about:blank' }), 20000, 'The page browser did not start in time.');
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (mth, p) => cdp.send(mth, p, s);
    await call('Page.enable'); await call('Network.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: D.w, height: D.h, deviceScaleFactor: 1, mobile: D.mobile });
    await call('Network.setUserAgentOverride', { userAgent: D.ua });
    // Animations finish at once, so text that fades in is measured at its final colour.
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }).catch(() => {});
    let inflight = 0, lastNet = Date.now(), loaded = false, status = 0; const ids = new Set();
    cdp.on((msg) => {
      if (msg.sessionId !== s) return;
      if (msg.method === 'Network.requestWillBeSent') { ids.add(msg.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') { ids.delete(msg.params.requestId); inflight = ids.size; lastNet = Date.now(); }
      else if (msg.method === 'Network.responseReceived' && msg.params.type === 'Document' && !status) status = msg.params.response.status;
      else if (msg.method === 'Page.loadEventFired') loaded = true;
    });
    const nav = await call('Page.navigate', { url });
    if (nav.errorText) throw new Error('The page could not be opened (' + nav.errorText + ').');
    const quiet = async (maxMs, need) => { const end = Date.now() + maxMs; while (Date.now() < end) { if ((loaded || need === 0) && inflight <= 2 && Date.now() - lastNet > 700) return; await sleep(150); } };
    await quiet(Math.min(30000, timeout / 3));
    if (status >= 400) throw new Error(`The page answered with an error (${status}).`);
    const ev = async (fn, ...a) => {
      const r = await call('Runtime.evaluate', { expression: `(${fn})(${a.map((x) => JSON.stringify(x)).join(',')})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('The page could not be read: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 160));
      return r.result.value;
    };
    await within(ev(SETTLE, MAX_H), 30000, 'The page took too long to finish drawing.');
    await quiet(4000, 0);
    // Pop-ups that open on their own would cover the page: closed for the measuring.
    await ev(`(() => { document.querySelectorAll('#dmPopup, .dmPopup, [class*="popup"][style*="display: block"]').forEach((e) => { e.style.display = 'none'; }); return true; })`).catch(() => {});
    const { items, h: pageH } = await ev(COLLECT, MAX_H, MAX_ITEMS);
    await sleep(250);
    await ev(HIDE, true);
    await sleep(350);
    // Jobs: the text's own boxes, and for a field the ring just outside it.
    const jobs = [];
    items.forEach((it, i) => {
      jobs.push({ id: 't' + i, boxes: it.boxes || [it.box], y: (it.boxes ? it.boxes[0] : it.box).y });
      if (it.kind === 'field' && it.outer) {
        const o = it.outer, k = 5;
        jobs.push({ id: 'o' + i, boxes: [{ x: o.x - k - 2, y: o.y, w: k, h: o.h }, { x: o.x + o.w + 2, y: o.y, w: k, h: o.h }, { x: o.x, y: o.y - k - 2, w: o.w, h: k }, { x: o.x, y: o.y + o.h + 2, w: o.w, h: k }], y: o.y });
      }
    });
    const H = Math.max(D.h, Math.min(Math.ceil(pageH || D.h), MAX_H));
    const SL = 1500; const m = {};
    for (let y = 0; y < H; y += SL) {
      const sh = Math.min(SL, H - y);
      const here = jobs.filter((j) => j.y >= y - 40 && j.y < y + sh);
      if (!here.length) continue;
      const shot = await within(call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y, width: D.w, height: sh, scale: 1 } }), 30000, 'Taking the picture took too long.');
      Object.assign(m, await ev(MEASURE, shot.data, y, D.w, sh, here));
    }
    await ev(HIDE, false).catch(() => {});
    return { items: judge(items, m, device), measured: items.length, ms: Date.now() - t0, status };
  } catch (e) {
    if (/browser (stopped|could not start|did not start)/.test(String(e.message)) && errText.trim()) e.message = `${e.message} (${errText.trim().split('\n').slice(-3).join(' | ').slice(0, 400)})`;
    throw e;
  } finally {
    clearTimeout(deadline);
    try { await within(cdp.send('Browser.close'), 2000); } catch (e) { /* kill below */ }
    killAll();
  }
}
