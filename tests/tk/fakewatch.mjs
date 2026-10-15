// Fake Duda API + fake live websites for the live content check.  node fakewatch.mjs <port>
// The website served depends on the Host header: localhost:<port> is "Buff & Beyond" (a blog post
// copied from another detailer), 127.0.0.1:<port> is "Clean Car Co" (fine until /__dirty is called).
import http from 'node:http';
const port = Number(process.argv[2] || 8097);
const calls = { pages: 0, duda: 0 };
let dirty = false; let limit = 0; let blocked = false; let gone404 = '';
const SITES = {
  abc123: { name: 'Buff & Beyond', phone: '610-555-0100', email: 'hello@buffandbeyond.com', street: '12 Oak Ave', city: 'Allentown', st: 'PA', zip: '18101', fb: 'buffandbeyond' },
  clean1: { name: 'Clean Car Co', phone: '303-555-0142', email: 'info@cleancar.co', street: '9 Pine Rd', city: 'Denver', st: 'CO', zip: '80202', fb: 'cleancarco' },
};
const content = (s) => ({ business_data: { name: s.name }, location_data: { phones: [{ phoneNumber: s.phone }], emails: [{ emailAddress: s.email }],
  address: { streetAddress: s.street, city: s.city, region: s.st, postalCode: s.zip, country: 'US' }, social_accounts: { facebook: s.fb } } });
const footer = (s) => `<footer><p>${s.street}, ${s.city}, ${s.st} ${s.zip}</p><a href="tel:${s.phone}">${s.phone}</a> <a href="mailto:${s.email}">${s.email}</a>
  <a href="https://www.facebook.com/${s.fb}">Facebook</a><p>© 2026 ${s.name}. All rights reserved.</p><p>Website by Detailers Roadmap</p></footer>`;
const page = (s, body) => `<!doctype html><html><head><title>${s.name}</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'AutoWash', name: s.name, telephone: s.phone })}</script></head><body><header><a href="/">${s.name}</a></header>${body}${footer(s)}</body></html>`;
const BUFF = {
  '/': '<h1>Car detailing in Allentown</h1><p>Book a detail today.</p>',
  '/services': '<h1>Services</h1><p>We serve Bethlehem, PA 18015 and the whole valley.</p><p>Partner line: (484) 555-0111</p>',
  '/blog/ceramic-coating': `<article><h1>Is ceramic coating worth it?</h1><p>Visit Glossy Garage at 4821 Elm Ridge Rd, Plano, TX 75023 or call <a href="tel:4695550199">(469) 555-0199</a>.</p>
    <p>Email <a href="mailto:info@glossygarage.com">info@glossygarage.com</a> · <a href="https://www.facebook.com/glossygaragetx">Glossy Garage on Facebook</a></p>
    <iframe src="https://www.google.com/maps/embed/v1/place?q=4821+Elm+Ridge+Rd,+Plano,+TX+75023"></iframe><p>© Glossy Garage LLC</p></article>`,
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const host = String(req.headers.host || '');
  if (u.pathname === '/__calls') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(calls)); }
  if (u.pathname === '/__dirty') { dirty = true; return res.end('ok'); }
  if (u.pathname === '/__clean') { dirty = false; return res.end('ok'); }
  if (u.pathname === '/__block') { blocked = u.searchParams.get('on') === '1'; return res.end('ok'); }
  if (u.pathname === '/__404') { gone404 = u.searchParams.get('host') || ''; return res.end('ok'); }
  if (u.pathname === '/__limit') { limit = Number(u.searchParams.get('n') || 0); return res.end('ok'); }
  const m = u.pathname.match(/^\/api\/sites\/multiscreen\/([^/]+)(\/content)?$/);
  if (m) {
    calls.duda++;
    if (limit > 0) { limit--; res.statusCode = 429; res.setHeader('Retry-After', '30'); return res.end('{"error":"rate limit"}'); }
    const s = SITES[m[1]]; res.setHeader('Content-Type', 'application/json');
    if (!s) { res.statusCode = 404; return res.end('{}'); }
    return res.end(JSON.stringify(m[2] ? content(s) : { site_name: m[1], site_business_info: { business_name: s.name } }));
  }
  if (blocked) { res.statusCode = 403; return res.end('blocked'); }
  if (gone404 && host.startsWith(gone404)) { res.statusCode = 404; return res.end('nope'); }
  const site = host.startsWith('localhost') ? 'abc123' : host.startsWith('127.0.0.1') ? 'clean1' : '';
  const s = SITES[site];
  if (!s) { res.statusCode = 404; return res.end('no such site'); }
  const pages = site === 'abc123' ? BUFF : { '/': '<h1>Clean Car Co</h1>', '/about': dirty ? '<p>Call our other shop: <a href="tel:7205550177">720-555-0177</a></p>' : '<p>Family owned.</p>' };
  if (u.pathname === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml');
    return res.end(`<?xml version="1.0"?><urlset>${Object.keys(pages).map((p) => `<url><loc>http://${host}${p}</loc></url>`).join('')}<url><loc>https://elsewhere.example/x</loc></url></urlset>`);
  }
  if (!pages[u.pathname]) { res.statusCode = 404; return res.end('not found'); }
  calls.pages++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page(s, pages[u.pathname]));
}).listen(port, '0.0.0.0', () => console.log('fake watch on ' + port));
