// Fetching addresses that come from outside the app (links found on a page, social profile links).
// Such an address must never reach the server's own network: localhost, private ranges, the cloud's
// metadata address. It is checked on the name AND on what the name resolves to, and again on every
// redirect (a public page can redirect to a private one).
import dns from 'node:dns';
import { fetchWithTimeout } from './_lib.js';

const PRIV4 = (ip) => {
  const p = String(ip).split('.').map(Number);
  return p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255)) || p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 192 && p[1] === 0 && p[2] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19)) || p[0] >= 224;
};
const PRIV6 = (ip) => {
  const x = String(ip).toLowerCase();
  if (x.startsWith('::ffff:')) return PRIV4(x.slice(7));
  return x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
};

/** true when the address is http(s) on a public host. A name that does not resolve is let through (the request then fails by itself). */
export async function publicAddress(raw) {
  let u; try { u = new URL(String(raw)); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (/^[\d.]+$/.test(h)) return !PRIV4(h);
  if (h.includes(':')) return !PRIV6(h);
  try {
    const all = await dns.promises.lookup(h, { all: true });
    return all.every((a) => (a.family === 6 ? !PRIV6(a.address) : !PRIV4(a.address)));
  } catch (e) { return true; }
}

/** fetch() for outside addresses: refuses private ones and follows redirects itself, checking each hop. */
export async function fetchPublic(url, opts = {}, ms = 20000) {
  let cur = String(url);
  for (let hop = 0; hop < 6; hop++) {
    if (!(await publicAddress(cur))) { const e = new Error('Address not allowed'); e.blocked = true; throw e; }
    const r = await fetchWithTimeout(cur, Object.assign({}, opts, { redirect: 'manual' }), ms);
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!loc) { try { Object.defineProperty(r, 'url', { value: cur }); } catch (e) { /* keep */ } return r; }
    cur = new URL(loc, cur).href;
    if (r.status === 303) opts = Object.assign({}, opts, { method: 'GET', body: undefined });
  }
  throw new Error('Too many redirects');
}

export const _test = { PRIV4, PRIV6 };
