// Reading a Word document (.docx) the way the copywriters write them for us.
//
// A .docx is a zip of XML files. Only two matter: word/document.xml (the text, in order, tables
// included) and word/_rels/document.xml.rels (where links point). No library is needed: the zip is
// read with Node's own zlib, and the XML is walked tag by tag.
//
// Then the copywriters' own conventions are applied:
//   TITLE: / PAGE NAME: / META TITLE:   → the page's SEO title (whatever it is called)
//   META DESCRIPTION:                   → the meta description
//   BUTTON> GET A QUOTE BUTTON> CALL …  → buttons (several can share a line)
//   DEVELOPER>>> / INSERT>>> / NOTE:    → notes for the designer, not copy
//   "Website Pages To Include:" + list  → the pages the website should have
//   the table at the top                → client information (name, email, address, phone, colours…)
// A new page starts at an upper-case page name from that list, or at a title line. The AI then
// looks the result over (see op 'docread' in ai.js) and names each page the way a visitor would.
import zlib from 'node:zlib';

/** The files inside a zip, by name → Buffer (only the ones asked for). */
export function unzip(buf, want) {
  const out = {};
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a Word document (.docx).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!want.includes(name)) continue;
    const ln = buf.readUInt16LE(loff + 26), lx = buf.readUInt16LE(loff + 28);
    const data = buf.slice(loff + 30 + ln + lx, loff + 30 + ln + lx + csize);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
  }
  return out;
}

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

/** Paragraphs in reading order: { text, bold, heading, list, cell: 'r.c' or '', links: [url] }. */
export function paragraphs(docx) {
  const files = unzip(docx, ['word/document.xml', 'word/_rels/document.xml.rels']);
  const xml = (files['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
  if (!xml) throw new Error('This Word document has no text in it.');
  const rels = {};
  String(files['word/_rels/document.xml.rels'] || '').replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => {
    const id = (a.match(/\bId="([^"]+)"/) || [])[1]; const t = (a.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && t) rels[id] = ent(t);
    return '';
  });
  const out = [];
  let cur = null; let inT = false; let bold = false; let runBold = false; let allBold = true; let tbl = 0; let row = -1; let col = -1;
  const tag = /<(\/?)(w:[\w]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tag.exec(xml))) {
    if (m[5] !== undefined) { if (inT && cur) cur.text += ent(m[5]); continue; }
    const close = m[1] === '/', name = m[2], attrs = m[3], self = m[4] === '/';
    if (name === 'w:tbl') { tbl += close ? -1 : 1; if (!close) { row = -1; } continue; }
    if (name === 'w:tr' && !close) { row++; col = -1; continue; }
    if (name === 'w:tc' && !close) { col++; continue; }
    if (name === 'w:p') {
      if (!close && !self) { cur = { text: '', bold: false, heading: 0, list: false, cell: tbl > 0 ? `${row}.${col}` : '', links: [] }; allBold = true; }
      else if (cur) { cur.text = cur.text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim(); cur.bold = allBold && !!cur.text; if (cur.text || cur.links.length) out.push(cur); cur = null; }
      continue;
    }
    if (!cur) continue;
    if (name === 'w:pStyle' && !close) { const v = (attrs.match(/w:val="([^"]+)"/) || [])[1] || ''; const h = v.match(/heading\s*(\d)/i) || v.match(/^Title$/i); if (h) cur.heading = Number(h[1]) || 1; continue; }
    if (name === 'w:numPr' && !close) { cur.list = true; continue; }
    if (name === 'w:r') { if (!close) runBold = false; continue; }
    if (name === 'w:b' && !close) { runBold = !/w:val="(0|false)"/.test(attrs); continue; }
    if (name === 'w:t') { inT = !close && !self; if (!close && !self) bold = runBold; if (close) { /* a run of text ended */ } if (!close && !self && !bold) allBold = allBold && false; continue; }
    if ((name === 'w:tab' || name === 'w:br' || name === 'w:cr') && !close) { cur.text += name === 'w:tab' ? '\t' : '\n'; continue; }
    if (name === 'w:hyperlink' && !close) { const id = (attrs.match(/r:id="([^"]+)"/) || [])[1]; if (id && rels[id]) cur.links.push(rels[id]); continue; }
  }
  return out;
}

// ---------- the copywriters' conventions ----------
const TITLE_RE = /^\s*(page\s*name|seo\s*title|meta\s*title|page\s*title|title(?:\s*tag)?)\s*[:：\-–]\s*(.*)$/i;
const META_RE = /^\s*meta\s*desc(?:ription)?\s*[:：\-–]\s*(.*)$/i;
const URL_RE = /^\s*(?:page\s*)?(?:url|slug|link)\s*[:：\-–]\s*(.*)$/i;
const BUTTON_RE = /\bBUTTON\s*>+\s*/i;
const NOTE_RE = /^\s*(developer|dev|designer|writer|insert|note|notes|editor)\b[^a-z]{0,3}(>{1,}|:)/i;
const isUpper = (t) => /[A-Z]/.test(t) && t === t.toUpperCase() && t.length <= 70;
const norm = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The document as pages: { client: {label: value}, requested: [names], site: 'www…', pages: [{ name, title, meta, url, blocks: [{t: 'text'|'heading'|'button'|'note', text}] }], footer: [...] }
 */
export function readDocx(buf, fileName) {
  const ps = paragraphs(buf);
  const lines = [];
  ps.forEach((p) => String(p.text).split('\n').forEach((t) => { t = t.replace(/\t+/g, ' ').trim(); if (t) lines.push(Object.assign({}, p, { text: t })); }));
  const out = { file: fileName || '', client: {}, requested: [], site: '', pages: [], footer: [], notes: [] };
  // The requested page list.
  const reqAt = lines.findIndex((l) => /pages?\s+to\s+include/i.test(l.text));
  if (reqAt >= 0) {
    let listed = false;
    for (let i = reqAt + 1; i < lines.length && out.requested.length < 60; i++) {
      const numbered = lines[i].list || /^\d+[.)]/.test(lines[i].text);
      const t = lines[i].text.replace(/^\d+[.)]\s*/, '').trim();
      // The list ends where the numbering ends (the first page's own name usually follows it).
      if ((listed && !numbered) || !(numbered || isUpper(t)) || t.length > 70 || /:/.test(t) || out.requested.some((r) => norm(r) === norm(t))) break;
      if (numbered) listed = true;
      out.requested.push(t);
    }
  }
  const reqSet = new Map(out.requested.map((r) => [norm(r), r]));
  // Client information: "Label: value" lines before the first page (the table at the top).
  const firstPage = lines.findIndex((l, i) => i > reqAt + out.requested.length && (TITLE_RE.test(l.text) || reqSet.has(norm(l.text))));
  lines.slice(0, firstPage < 0 ? Math.min(lines.length, 40) : firstPage).forEach((l) => {
    const m = l.text.match(/^([A-Za-z][A-Za-z ()/&-]{1,40}?)\s*:\s*(.+)$/);
    if (m && !/pages to include/i.test(m[1])) out.client[m[1].trim()] = m[2].trim();
    const site = l.text.match(/(?:new page addition to current website|website|current website)\s*:\s*((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}[^\s]*)/i);
    if (site && !out.site) out.site = site[1];
  });
  // Pages.
  let page = null; let section = 'pre';
  const start = (name, at) => { page = { name: name || '', title: '', meta: '', url: '', at, blocks: [] }; out.pages.push(page); section = 'page'; };
  for (let i = Math.max(0, firstPage); i < lines.length; i++) {
    const l = lines[i]; const t = l.text;
    if (/^global\s+footer\b/i.test(t)) { section = 'footer'; page = null; continue; }
    if (section === 'footer') { if (reqSet.has(norm(t)) || TITLE_RE.test(t)) section = 'pre'; else { out.footer.push(t); continue; } }
    const isReq = reqSet.has(norm(t)) && !l.cell;
    const tm = t.match(TITLE_RE);
    if (isReq) { start(reqSet.get(norm(t)), i); continue; }
    // An upper-case name right above a title is a page name too ("WINDOW TINT" for "WINDOW TINTING").
    if (isUpper(t) && !l.cell && !BUTTON_RE.test(t) && !NOTE_RE.test(t) && lines.slice(i + 1, i + 4).some((x) => TITLE_RE.test(x.text))) { start(t, i); continue; }
    if (tm) {
      // A title right after a page name belongs to that page; otherwise it starts a new one.
      if (!page || page.title || page.blocks.length > 2) start('', i);
      page.title = tm[2].trim();
      // "PAGE NAME:" that is really a meta title: kept as the title, the AI names the page.
      continue;
    }
    if (!page) { if (NOTE_RE.test(t)) out.notes.push(t); continue; }
    const mm = t.match(META_RE); if (mm) { page.meta = mm[1].trim(); continue; }
    const um = t.match(URL_RE); if (um && !page.url) { page.url = um[1].trim(); continue; }
    if (NOTE_RE.test(t) || /^\(?\s*(do not|don't)\b/i.test(t)) { page.blocks.push({ t: 'note', text: t }); continue; }
    if (BUTTON_RE.test(t)) {
      t.split(/\bBUTTON\s*>+\s*/i).map((x) => x.trim()).filter(Boolean).forEach((b, k) => {
        if (k === 0 && !BUTTON_RE.test(t.slice(0, t.search(BUTTON_RE) + 1)) && t.search(BUTTON_RE) > 0) page.blocks.push({ t: 'text', text: b });
        else page.blocks.push({ t: 'button', text: b });
      });
      continue;
    }
    const heading = l.heading || (l.bold && t.length <= 90) || (t.length <= 70 && !/[.!?:]$/.test(t) && t.split(/\s+/).length <= 10);
    page.blocks.push({ t: heading ? 'heading' : 'text', text: t, ...(l.cell ? { cell: l.cell } : {}), ...(l.list ? { list: true } : {}) });
  }
  // A page with no name: named after its title for now (the AI does better).
  out.pages.forEach((p, i) => { if (!p.name) p.name = p.title.replace(/\s*[|–-]\s*[^|–-]+$/, '').trim() || `Page ${i + 1}`; delete p.at; });
  out.pages = out.pages.filter((p) => p.title || p.meta || p.blocks.filter((b) => b.t !== 'note').length >= 2);
  return out;
}
