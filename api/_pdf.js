// Reading the words out of a PDF, with nothing installed.
//
// The app has no dependencies and this is not the place to start: a PDF text layer is a well
// specified thing and the briefs we care about are ordinary generated documents, not exotica. So
// this inflates the content streams and walks the text-showing operators.
//
// What it deliberately does NOT do is OCR. A brief that was scanned or photographed has no text in
// it at all, and the honest answer there is to say so and let somebody type six fields in, rather
// than to guess. `extractText` returning nothing is that answer, and the caller says it in words.
import zlib from 'node:zlib';

/**
 * ASCII85, which plenty of generators put in FRONT of the compression.
 *
 * This is the filter that makes a naive reader decide a perfectly ordinary PDF has no text in it:
 * the inflate fails, the stream is skipped, and the file looks like a scan.
 */
function ascii85(buf) {
  let s = buf.toString('latin1').replace(/\s/g, '');
  if (s.startsWith('<~')) s = s.slice(2);
  const end = s.indexOf('~>');
  if (end >= 0) s = s.slice(0, end);
  const out = [];
  let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && tuple.length === 0) { out.push(0, 0, 0, 0); continue; }
    const v = ch.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    tuple.push(v);
    if (tuple.length === 5) {
      let n = 0;
      for (const t of tuple) n = n * 85 + t;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      tuple = [];
    }
  }
  if (tuple.length > 1) {
    const missing = 5 - tuple.length;
    for (let k = 0; k < missing; k++) tuple.push(84);
    let n = 0;
    for (const t of tuple) n = n * 85 + t;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, 4 - missing));
  }
  return Buffer.from(out);
}

const asciiHex = (buf) => {
  const s = buf.toString('latin1').split('>')[0].replace(/[^0-9a-fA-F]/g, '');
  const b = [];
  for (let i = 0; i + 1 < s.length; i += 2) b.push(parseInt(s.slice(i, i + 2), 16));
  if (s.length % 2) b.push(parseInt(s[s.length - 1] + '0', 16));
  return Buffer.from(b);
};

const inflate = (buf) => {
  try { return zlib.inflateSync(buf); }
  catch (e) { try { return zlib.inflateRawSync(buf.subarray(2)); } catch (e2) { return null; } }
};

/** Every content stream in the file, decoded through its whole filter chain, in order. */
function streams(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length && out.length < 4000) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    // The dictionary just before this stream says how it was encoded.
    const dictStart = Math.max(0, buf.lastIndexOf('<<', s));
    const dict = buf.slice(dictStart, s).toString('latin1');
    let p = s + 6;
    if (buf[p] === 0x0d) p++;
    if (buf[p] === 0x0a) p++;
    const e = buf.indexOf('endstream', p);
    if (e < 0) break;
    let raw = buf.subarray(p, e);
    i = e + 9;
    // An image or a font is most of a PDF by weight and none of it by meaning.
    if (/\/Subtype\s*\/Image|\/FontFile|\/Type\s*\/XObject(?![\s\S]*\/Form)/.test(dict)) continue;

    // /Filter may be one name or an array of them, and they apply in the order written.
    const fm = dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
    const chain = fm ? (fm[1].match(/\/[A-Za-z0-9]+/g) || []).map((x) => x.slice(1)) : [];
    let bad = false;
    for (const f of chain) {
      if (f === 'FlateDecode') { const d = inflate(raw); if (!d) { bad = true; break; } raw = d; }
      else if (f === 'ASCII85Decode') raw = ascii85(raw);
      else if (f === 'ASCIIHexDecode') raw = asciiHex(raw);
      else if (f === 'Crypt') continue;
      else { bad = true; break; }   // LZW, RunLength, DCT, JPX, CCITTFax — not text we can read
    }
    if (bad) continue;
    const text = raw.toString('latin1');
    // Only streams that actually show text are worth walking.
    if (/(Tj|TJ|'|")\s/.test(text) || /BT[\s\S]*ET/.test(text)) out.push(text);
  }
  return out;
}

/** PDF string escapes, including the octal ones. */
function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (/^[0-7]{1,3}$/.test(g)) return String.fromCharCode(parseInt(g, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[g] || g;
  });
}

/** A hex string: <48656c6c6f>, and the UTF-16 form a lot of generators emit. */
function fromHex(h) {
  const clean = h.replace(/[^0-9a-fA-F]/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  if (bytes.length > 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return bytes.map((b) => String.fromCharCode(b)).join('');
}

/**
 * The words, with the line breaks roughly where the page had them.
 *
 * Line structure matters more than it looks: a brief is mostly "Label: value" pairs, and a value on
 * the line under its label is the normal case. Flattening everything to one blob loses that.
 */
export function extractText(buf) {
  const parts = [];
  for (const s of streams(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))) {
    // Walk the operators in order so a new line really becomes a new line.
    const re = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|\[(?:[^\][]|\\.)*\]\s*TJ|\bT[dD]\b|\bT\*\b|\bTJ\b|\bTj\b|\bET\b|\bBT\b|'|"/g;
    let m;
    let pending = '';
    while ((m = re.exec(s))) {
      const tok = m[0];
      if (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'ET' || tok === "'" || tok === '"') {
        if (pending.trim()) { parts.push(pending.trim()); pending = ''; }
        continue;
      }
      if (tok.endsWith('TJ') && tok.startsWith('[')) {
        // [(He)-250(llo)] TJ — the numbers are kerning; a big gap is a space.
        const inner = tok.slice(1, tok.lastIndexOf(']'));
        const bits = inner.match(/\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|-?\d+(?:\.\d+)?/g) || [];
        bits.forEach((b) => {
          if (b.startsWith('(')) pending += unescapePdf(b.slice(1, -1));
          else if (b.startsWith('<')) pending += fromHex(b.slice(1, -1));
          else if (Number(b) <= -120) pending += ' ';
        });
        continue;
      }
      if (tok.startsWith('(')) { pending += unescapePdf(tok.slice(1, -1)); continue; }
      if (tok.startsWith('<')) { pending += fromHex(tok.slice(1, -1)); continue; }
    }
    if (pending.trim()) parts.push(pending.trim());
  }
  return parts.join('\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Turning that text into the facts a website is built from
// ---------------------------------------------------------------------------
const LABELS = {
  businessName: /^(business|company|client|shop|trade|legal)?\s*(name|business)\s*(of business)?$/i,
  phone: /^(phone|telephone|tel|mobile|cell|contact)\s*(number|no\.?|#)?$/i,
  email: /^(e-?mail|email)\s*(address)?$/i,
  address: /^(address|street|location|business address|shop address|mailing address)$/i,
  hours: /^(hours|opening hours|business hours|hours of operation|office hours)$/i,
  website: /^(website|url|domain|web ?site address)$/i,
};
const RE = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  // North American and international-ish, which is what these briefs are.
  phone: /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  zipLine: /\b[A-Z][a-zA-Z.\- ]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/,
  url: /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|net|org|co|us|ca|biz|shop|auto)\b[^\s,]*/i,
};

/**
 * Strip a leading "Label:" without eating a time.
 *
 * "Monday - Friday 8:00 AM" has a colon in it, so stripping up to the first colon turns it into
 * "00 AM". Only text that actually looks like a label is removed.
 */
function stripLabel(line) {
  const s = String(line || '').trim();
  const c = s.indexOf(':');
  if (c <= 0 || c > 30) return s;
  const before = s.slice(0, c);
  // A label is words, not digits, and the thing after it is not the rest of a clock time.
  if (/\d/.test(before) || /^\d{2}\b/.test(s.slice(c + 1).trim())) return s;
  return s.slice(c + 1).trim() || s;
}

/** Does this line start a different field? Used to stop a multi-line value running on. */
function isLabelLine(line) {
  const s = String(line || '').trim();
  const c = s.indexOf(':');
  const key = (c > 0 && c < 40 ? s.slice(0, c) : s).replace(/[*?#]/g, '').trim();
  return Object.values(LABELS).some((re) => re.test(key));
}

/** "Label: value", "Label value" on the next line, and a bare value under a heading. */
function labelled(lines) {
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    let key = '', val = '';
    if (colon > 0 && colon < 40) { key = line.slice(0, colon).trim(); val = line.slice(colon + 1).trim(); }
    else { key = line.trim(); val = ''; }
    const cleanKey = key.replace(/[*?#]/g, '').replace(/\s+/g, ' ').trim();
    for (const [field, re] of Object.entries(LABELS)) {
      if (found[field] || !re.test(cleanKey)) continue;
      // The value is on this line after the colon, or on the next non-empty line.
      let v = val;
      let j = i;
      while (!v && ++j < lines.length && j <= i + 2) { const n = lines[j].trim(); if (n && !n.endsWith(':')) v = n; }
      if (field === 'hours') {
        // Hours run over several lines far more often than not.
        const block = [];
        for (let k = (val ? i : i + 1); k < Math.min(lines.length, i + 10); k++) {
          const t = stripLabel(lines[k]);
          if (!t) { if (block.length) break; continue; }
          if (/^(mon|tue|wed|thu|fri|sat|sun|weekday|weekend|daily|open|closed|\d{1,2})/i.test(t)) block.push(t);
          else if (block.length) break;
        }
        if (block.length) v = block.join('\n');
      }
      if (field === 'address') {
        // An address is two or three lines: street, then town/state/postcode. Taking only the first
        // line gives a street with no town, which is worse than nothing — it looks complete.
        const block = [];
        for (let k = (val ? i : i + 1); k < Math.min(lines.length, i + 6); k++) {
          const t = k === i && val ? val : stripLabel(lines[k]);
          if (!t) { if (block.length) break; continue; }
          if (isLabelLine(t)) break;
          block.push(t);
          if (RE.zipLine.test(t) || /\b\d{5}(-\d{4})?\b/.test(t)) break;   // the postcode ends an address
        }
        if (block.length) v = block.join(', ');
      }
      if (v && v.length < 400) found[field] = v.trim();
    }
  }
  return found;
}

/**
 * The business facts a brief is carrying.
 *
 * Labels first, because a brief is usually a form and a label is an answer somebody gave rather than
 * a pattern we matched. Patterns only fill what the labels missed, and every value says which way it
 * was found — so the screen can show a guess differently from an answer, and nobody has to trust
 * either without looking.
 */
export function findFacts(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const byLabel = labelled(lines);
  const out = {};
  const put = (k, v, how) => { if (v && !out[k]) out[k] = { value: String(v).trim().slice(0, 300), how }; };

  Object.entries(byLabel).forEach(([k, v]) => put(k, v, 'labelled'));

  const whole = lines.join('\n');
  const em = whole.match(RE.email); if (em) put('email', em[0].toLowerCase(), 'found');
  const ph = whole.match(RE.phone); if (ph) put('phone', ph[0], 'found');
  const ad = whole.match(RE.zipLine);
  if (ad) {
    // Take the street line above the "City, ST 12345" line when there is one, and start at the
    // street number: a line of prose that happens to contain an address is not an address.
    const idx = lines.findIndex((l) => RE.zipLine.test(l));
    const here = lines[idx];
    const sameLine = here.search(/\b\d+\s+[A-Z]/);
    if (sameLine >= 0) put('address', here.slice(sameLine), 'found');
    else {
      const prev = idx > 0 ? lines[idx - 1] : '';
      const start = prev.search(/\b\d+\s+[A-Z]/);
      put('address', (start >= 0 && prev.length < 90 ? prev.slice(start) + ', ' : '') + here, 'found');
    }
  }
  const site = whole.match(RE.url); if (site) put('website', site[0].replace(/^https?:\/\//, ''), 'found');
  // The business name is the hardest to guess, so it is only ever taken from a label. A wrong name
  // is worse than a blank one: it becomes the reference every later audit is checked against.
  // Everything else a person can see is wrong at a glance; a plausible-but-wrong name they cannot.

  // Duplicate phone numbers are common (header and footer); a second DIFFERENT one is worth keeping.
  const phones = [...new Set((whole.match(new RegExp(RE.phone.source, 'g')) || []).map((x) => x.trim()))];
  if (phones.length > 1) out.otherPhones = phones.slice(1, 4);
  const emails = [...new Set((whole.match(new RegExp(RE.email.source, 'g')) || []).map((x) => x.toLowerCase()))];
  if (emails.length > 1) out.otherEmails = emails.slice(1, 4);
  return out;
}

/** Everything in one go: bytes in, facts and the raw text out. */
export function readBrief(buf) {
  const text = extractText(buf);
  if (!text || text.length < 40) {
    return { text: '', facts: {}, readable: false,
      why: 'There is no text in this PDF — it looks like a scan or a photograph rather than a document. The details will need typing in.' };
  }
  return { text, facts: findFacts(text), readable: true, why: '' };
}
