// POST /api/social { urls: [facebook / google maps / gbp links] }
// Best-effort read of public profile metadata (name, phone, email) to compare with Business Info.
// Facebook and Google often block automated reads — anything we can't read is returned as "unverified".
import { authorize, fetchWithTimeout, readBody } from './_lib.js';

const PHONE = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-](\d{4})/g;
const EMAIL = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] || m[2] || '') : '';
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

async function read(url) {
  let u; try { u = new URL(url); } catch (e) { return { url, ok: false, error: 'invalid URL' }; }
  const isFb = /facebook\.com|fb\.com/i.test(u.hostname);
  // Facebook serves Open Graph tags to its own crawler user agent
  const ua = isFb ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' : 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' }, 12000);
    const html = (await r.text()).slice(0, 600000);
    const title = meta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const description = meta(html, 'og:description') || meta(html, 'description');
    const blob = [title, description].join(' ');
    const phones = [...new Set([...blob.matchAll(PHONE)].map((m) => m[1] + m[2] + m[3]))];
    const emails = [...new Set((blob.match(EMAIL) || []).map((e) => e.toLowerCase()))];
    const blocked = !title || /log in|log into|sign in|facebook$|^google maps$/i.test(title.trim());
    return { url, ok: r.ok && !blocked, status: r.status, finalUrl: r.url, title: decode(title).trim(), description: description.slice(0, 400), phones, emails };
  } catch (e) {
    return { url, ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  }
}

export default async function handler(req, res) {
  if (!authorize(req, res)) return;
  const { urls } = readBody(req);
  if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls[] required' });
  res.status(200).json(await Promise.all(urls.slice(0, 8).map(read)));
}
