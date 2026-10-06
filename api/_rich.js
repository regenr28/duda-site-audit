// The rich text of an audit item written by hand, made safe on the way in.
//
// The browser already cleans it; this is the server not trusting that. Only a handful of tags
// survive, with no attributes except a link's address (http, https or mailto) and a picture's
// address, which must be one of our own uploads. Everything else is dropped, its text kept.
const KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li', 'a', 'img']);
const VOID = new Set(['br', 'img']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'textarea', 'select', 'svg', 'math']);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function attr(raw, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(raw);
  if (!m) return '';
  return (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').trim();
}

export function cleanRichHtml(html, max = 20000) {
  const src = String(html || '').slice(0, max * 2);
  const out = []; const open = []; let skip = '';
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[3] !== undefined || m[4] !== undefined) {
      if (skip) continue;
      // Text: already entity-encoded by the browser; a stray "<" is escaped here.
      out.push((m[3] !== undefined ? m[3] : '&lt;').replace(/>/g, '&gt;'));
      continue;
    }
    const tag = m[1].toLowerCase(); const closing = m[0][1] === '/';
    if (skip) { if (closing && tag === skip) skip = ''; continue; }
    if (DROP_WITH_CONTENT.has(tag)) { if (!closing && !/\/\s*$/.test(m[2])) skip = tag; continue; }
    if (!KEEP.has(tag)) continue;
    if (closing) {
      if (VOID.has(tag)) continue;
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (tag === 'a') {
      const href = attr(m[2], 'href');
      if (!/^(https?:\/\/|mailto:)/i.test(href)) { continue; }
      out.push(`<a href="${escAttr(href)}" target="_blank" rel="noopener">`); open.push('a'); continue;
    }
    if (tag === 'img') {
      const s = attr(m[2], 'src');
      if (/^\/api\/img\?id=[\w-]+$/.test(s)) out.push(`<img src="${escAttr(s)}">`);
      continue;
    }
    if (VOID.has(tag)) { out.push(`<${tag}>`); continue; }
    out.push(`<${tag}>`); open.push(tag);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

export const richToText = (html) => String(html || '').replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
