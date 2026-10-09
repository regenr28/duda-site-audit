// Shared by the server's page pictures and the helper in the live view, so both describe a page the same way.
/**
 * Runs in the page: every piece of text, every picture, link and button, with where it sits.
 * The address of each (a CSS selector) is built from the nearest element with a unique id, which
 * Duda gives to every widget and keeps across edits, so the same element can be found again later.
 */
export const MAP = `((MAX, SITE) => {
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
