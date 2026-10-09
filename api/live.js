// The live view of a website's draft, for a client to browse before marking something to change.
//
// GET /api/live?site=<record id>&device=desktop|tablet|mobile&path=/about
//
// The Duda preview page is fetched here and handed back with two things added at the top of
// <head>: a <base> so its pictures, styles and scripts still load from Duda, and a small helper
// script that tells the app which page is open, how far down it is scrolled, and what was clicked
// or hovered — so that when the client taps a drawing tool, the server can put a real browser into
// the same state and take the picture (see `replay` in _shoot.js).
//
// Nothing is installed in the website, and real visitors never get this script.
//
// The page is served LOCKED DOWN: a Content-Security-Policy sandbox gives it no origin of its own,
// so its scripts cannot read this app's storage, make signed-in requests to it, submit forms or open
// windows. Only scripts may run, which is what menus, sliders and pop-ups need.
import { fetchWithTimeout } from './_lib.js';
import { who, mayseeSite, cleanPath, siteRec, previewUrl } from './_tickets.js';
import { DEVICES } from './_shoot.js';

/** Runs inside the client's page. PATH and PREFIX are filled in per page. */
const HELPER = (path, prefix) => `(function () {
  var PATH = ${JSON.stringify(path)}, PREFIX = ${JSON.stringify(prefix)};
  // A page with no origin of its own throws on storage and cookies; many site scripts expect them,
  // so give them harmless in-memory stand-ins rather than letting them stop with an error.
  function mem() { var d = {}; return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); },
    removeItem: function (k) { delete d[k]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } }; }
  try { var ls = mem(), ss = mem(); Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return ls; } }); Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return ss; } }); } catch (e) {}
  try { var jar = ''; Object.defineProperty(document, 'cookie', { configurable: true, get: function () { return jar; }, set: function (v) { jar = String(v).split(';')[0]; } }); } catch (e) {}
  function post(m) { m.dsa = 1; try { parent.postMessage(m, '*'); } catch (e) {} }
  function sel(el) {
    var parts = [], e = el;
    while (e && e.nodeType === 1 && e !== document.documentElement) {
      if (e.id && /^[A-Za-z0-9_-]+$/.test(e.id) && document.querySelectorAll('[id="' + e.id + '"]').length === 1) { parts.unshift(/^\\d/.test(e.id) ? '[id="' + e.id + '"]' : '#' + e.id); break; }
      var i = 1, s = e; while ((s = s.previousElementSibling)) if (s.tagName === e.tagName) i++;
      parts.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')'); e = e.parentElement;
    }
    return parts.join(' > ');
  }
  function pagePath(u) {
    if (!/^https?:$/.test(u.protocol)) return null;
    var p = u.pathname, m = p.match(/^\\/site\\/[A-Za-z0-9_-]+(\\/.*)?$/);
    if (m) p = m[1] || '/'; else if (u.host !== location.host && u.host !== new URL(document.baseURI).host) return null;
    p = p.replace(/\\/+$/, '') || '/';
    return /^\\/[\\w\\-/.%~]*$/.test(p) && !/\\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)$/i.test(p) ? p : null;
  }
  var actions = [], hover = '';
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href]');
    if (a) {
      var href = a.getAttribute('href') || '';
      if (/^#/.test(href)) { actions.push({ s: sel(a) }); return; }
      if (/^(tel|mailto|sms|javascript):/i.test(href)) { ev.preventDefault(); post({ t: 'blocked', why: 'link' }); return; }
      var u; try { u = new URL(href, document.baseURI); } catch (e) { return; }
      var p = pagePath(u);
      ev.preventDefault(); ev.stopPropagation();
      if (p !== null && (u.pathname.indexOf(PREFIX) === 0 || u.host === new URL(document.baseURI).host)) post({ t: 'nav', path: p });
      else post({ t: 'blocked', why: 'external' });
      return;
    }
    actions.push({ s: sel(ev.target) });
    if (actions.length > 20) actions.shift();
  }, true);
  document.addEventListener('submit', function (ev) { ev.preventDefault(); post({ t: 'blocked', why: 'form' }); }, true);
  document.addEventListener('mouseover', function (ev) { hover = sel(ev.target); }, true);
  window.open = function () { post({ t: 'blocked', why: 'external' }); return null; };
  addEventListener('message', function (ev) {
    if (ev.source !== parent || !ev.data || ev.data.dsa !== 'state') return;
    post({ t: 'state', path: PATH, y: Math.round(scrollY), actions: actions.slice(), hover: hover, id: ev.data.id });
  });
  function links() {
    var out = [], seen = {};
    [].forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var u; try { u = new URL(a.getAttribute('href'), document.baseURI); } catch (e) { return; }
      var p = pagePath(u); if (p === null || seen[p] || out.length >= 80) return; seen[p] = 1;
      out.push({ p: p, t: (a.innerText || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 60) });
    });
    return out;
  }
  function ready() { post({ t: 'ready', path: PATH, title: document.title.slice(0, 200), links: links() }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font:15px -apple-system,Segoe UI,Roboto,sans-serif;color:#333;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:20px;text-align:center"><div>${text}</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const send = (code, html) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(code).end(html); };
  const w = await who(req, res);
  if (!w) return;
  const site = String(req.query.site || '');
  if (!mayseeSite(w, site)) return send(404, page('Not found', 'This page is not available.'));
  const device = DEVICES[req.query.device] ? req.query.device : 'desktop';
  const path = cleanPath(req.query.path);
  if (!path) return send(400, page('Not found', 'That page address is not valid.'));
  const rec = await siteRec(site);
  if (!rec) return send(404, page('Not found', 'This page is not available.'));
  try {
    const { url } = await previewUrl(rec, path, device);
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': DEVICES[device].ua, Accept: 'text/html' }, redirect: 'follow' }, 25000);
    let html = await r.text();
    if (r.status >= 400) return send(200, page('Not found', r.status === 404 ? 'This page does not exist on your website.' : 'This page could not be opened right now. Please try again in a moment.'));
    const base = new URL(r.url || url);
    const prefix = `/site/${rec.siteId || rec.id}`;
    const inject = `<base href="${esc(base.origin + prefix + '/')}"><script>${HELPER(path, prefix).replace(/<\/script/gi, '<\\/script')}</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
    return send(200, html);
  } catch (e) {
    return send(200, page('Not available', 'This page could not be opened right now. Please try again in a moment.'));
  }
}
