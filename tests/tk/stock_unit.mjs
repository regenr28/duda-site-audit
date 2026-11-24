// Unit checks for the editorial stock photo check (no browser): file names, and matching by name and by look.
// Usage: node stock_unit.mjs <app>
const APP = process.argv[2];
await import(APP + '/public/engine.js');
const A = globalThis.DudaAudit;
let ok = true;
const check = (c, label) => { console.log((c ? 'PASS ' : 'FAIL ') + label); ok = ok && !!c; };

check(A.stockIdOf('https://irp.cdn-website.com/abc/dms3rep/multi/shutterstock_2530975229-1920w.jpg') === '2530975229', 'shutterstock_ID file name (with Duda\'s width) gives the ID');
check(A.stockIdOf('https://x.cdn-website.com/a/Shutterstock%202326351331.jpeg?w=400') === '2326351331', 'an encoded space and query string are fine');
check(A.stockIdOf('https://x.cdn-website.com/a/vinnytsia-ukraine-august-04-2025-grey-260nw-2669861029.jpg') === '2669861029', 'a Shutterstock preview file name gives the ID');
check(A.stockIdOf('https://x.cdn-website.com/a/stock-photo-red-car-on-road-2685614241.jpg') === '2685614241', 'a stock-photo-…-ID file name gives the ID');
check(A.stockIdOf('https://x.cdn-website.com/a/IMG_20240101_123456789.jpg') === '', 'a phone photo with a long number is not a Shutterstock ID');
check(A.stockIdOf('https://x.cdn-website.com/a/ceramic-coating-2024.jpg') === '', 'an ordinary file name gives nothing');

// A 64-bit fingerprint, and one a few bits away (the same photo re-saved or watermarked).
const H = '1011001110001111010101001100110000111100101011010010110101100110';
const flip = (h, n) => h.split('').map((b, i) => (i % 9 === 0 && i / 9 < n ? (b === '1' ? '0' : '1') : b)).join('');
const FAR = '0100110001110000101010110011001111000011010100101101001010011001';
const place = (path, extra) => Object.assign({ path, device: 'desktop', selector: '#img-' + path.length, block: '#row-' + path.length, location: 'Body', how: 'img', hiddenBy: '' }, extra || {});
const entry = (url, hash, places, why) => ({ key: A.imageKey(url), url, m: hash ? { hash } : null, why: why || '', places });
const byKey = new Map();
const add = (e) => byKey.set(e.key, e);
add(entry('https://x.cdn-website.com/a/shutterstock_2530975229.jpg', FAR, [place('/'), place('/about')]));         // by name
add(entry('https://x.cdn-website.com/a/hero-renamed.jpg', flip(H, 5), [place('/services')]));                       // by look (5 bits off)
add(entry('https://x.cdn-website.com/a/our-shop.jpg', FAR, [place('/contact')]));                                    // own photo
add(entry('https://x.cdn-website.com/a/shutterstock_1111111111.jpg', FAR, [place('/blog')]));                        // unknown, editorial on lookup
add(entry('https://x.cdn-website.com/a/shutterstock_2222222222.jpg', FAR, [place('/blog')]));                        // unknown, not editorial
add(entry('https://x.cdn-website.com/a/shutterstock_2326351331.jpg', FAR, [place('/', { hiddenBy: 'hidden on every device' })])); // hidden
add(entry('https://x.cdn-website.com/a/pattern.png', flip(H, 2), [place('/')], 'too few colours to be a photo'));   // a graphic: not by look
const asked = [];
const saved = [];
const opts = {
  stockList: async () => [{ id: '2530975229' }, { id: '2669861029', h: H }, { id: '2326351331' }, { id: '2803000000', preview: '' }],
  stockLookup: async (ids) => { asked.push(...ids); return { 1111111111: { id: '1111111111', editorial: true, title: 'Kyiv, Ukraine - May 1, 2025: a car' }, 2222222222: { id: '2222222222', editorial: false } }; },
  stockSaveHash: async (id, h) => saved.push(id),
};
const log = [];
const out = await A.editorialStockFindings(byKey, opts, log);
const by = (id) => out.find((f) => f.stockId === id);
console.log('   items:', out.map((f) => `${f.stockId}/${f.stockHow}/${f.severity}`).join(', '));
check(by('2530975229') && by('2530975229').stockHow === 'name' && by('2530975229').severity === 'critical' && by('2530975229').code === 'STOCK_EDITORIAL', 'a picture named with a listed ID is a critical item, matched by name');
check(by('2530975229').dupPlaces.length === 2 && /\/about/.test(by('2530975229').snippet), 'it lists every place the picture is used');
check(by('2669861029') && by('2669861029').stockHow === 'look', 'a renamed copy (5 bits off the listed fingerprint) is matched by look');
check(/looks the same/.test(by('2669861029').reason), 'and the item says it was recognised by look');
check(asked.join(',') === '1111111111,2222222222', 'only IDs the list does not know are looked up: ' + asked.join(','));
check(by('1111111111') && by('1111111111').stockHow === 'name', 'an unknown ID Shutterstock marks editorial is reported');
check(!by('2222222222'), 'an unknown ID that is not editorial is not reported');
check(by('2326351331') && by('2326351331').severity === 'warning' && by('2326351331').visible === false, 'a hidden editorial picture is a warning, not critical');
check(out.length === 4, 'nothing else is reported (own photo, graphic): ' + out.length);
check(by('2530975229').stockUrl === 'https://www.shutterstock.com/image-photo/2530975229', 'the item links to the image on Shutterstock');
check(!JSON.stringify(out).includes('our-shop'), 'the business’s own photo is not reported');
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
