// Fake Duda preview pages for the ticket tests. node fixsite.mjs <port>
import http from 'node:http';
import zlib from 'node:zlib';
// A plain one-colour PNG (the photo tests need real raster photos: SVGs are icons, not photos).
function png(w, h, rgb) {
  const crc = (b) => { const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b) >>> 0); return c; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); return Buffer.concat([len, td, crc(td)]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO_COL = { 'sedan-interior': [120, 40, 40], 'rv-exterior': [40, 120, 60], 'shop-bg': [60, 60, 120], 'parallax-road': [90, 90, 90], 'iphone-shot': [200, 150, 60] };
const port = Number(process.argv[2] || 8093);
let version = 1;
const page = (p, dev) => `<!doctype html><html><head><title>${p === '/' ? 'Home' : 'About'} | Buff &amp; Beyond</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{overflow-x:hidden}body{margin:0;font-family:Arial,sans-serif;color:#222}.track{width:300%;height:80px;background:#9cf}
header{position:fixed;top:0;left:0;right:0;height:70px;background:#123;color:#fff;display:flex;align-items:center;gap:24px;padding:0 30px;z-index:9}
header a{color:#fff}
.dd{position:relative}.dd ul{display:none;position:absolute;top:30px;left:0;background:#fff;color:#123;list-style:none;margin:0;padding:10px 18px;box-shadow:0 4px 12px #0004}.dd.open ul{display:block}
.modal{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:420px;max-width:90vw;padding:30px;background:#fff;border:4px solid #c00;z-index:20}.modal.open{display:block}
.hero{height:100vh;background:linear-gradient(135deg,#2a6,#16a);color:#fff;display:flex;align-items:center;justify-content:center;font-size:${dev === 'mobile' ? 28 : 64}px}
.sec{padding:60px 30px;border-bottom:1px solid #ddd}.sec:nth-child(odd){background:#f5f5f0}
.fade{opacity:0;transition:opacity .4s}.fade.in{opacity:1}
.cards{display:flex;flex-wrap:wrap;gap:20px}.card{flex:1 1 280px;height:220px;background:#fc6;border-radius:8px;padding:20px}
</style></head><body>
<header id="1666500101"><b>Buff &amp; Beyond</b><a href="/site/abc123/">Home</a><a href="/site/abc123/about?preview=true">About</a><a href="/site/abc123/contact">Contact</a><a href="tel:3024217788">(302) 421-7788</a><span class="dd" id="ddServ"><button id="servBtn" onclick="this.parentNode.classList.toggle('open')">Services ▾</button><ul><li>Ceramic coating</li><li>Window tint</li></ul></span></header>
<div class="modal" id="bookModal"><h3>Book a detail</h3><p id="modalTxt">Pick a day that suits you.</p></div>
<div class="hero" id="1666500102"><h1>${p === '/' ? 'Shine like new' : 'About our shop'}</h1></div>
<div id="1666500103">${Array.from({ length: 14 }, (_, i) => `<div class="sec"><h2>Section ${i + 1}</h2><p class="fade" id="txt${i}">${i === 7 ? '<button id="bookBtn" onclick="document.getElementById(\'bookModal\').classList.add(\'open\')">Book now</button>' : ''}${i === 2 ? (version === 1 ? 'We open at 9am every weekday.' : 'We open at 8am every weekday.') : 'Paragraph number ' + (i + 1) + ' with some words about detailing your car properly.'}</p>
<div class="cards"><div class="card">Card A${i}</div><div class="card">Card B${i}</div><img loading="lazy" width="300" height="200" alt="Photo ${i}" src="/img.svg?i=${i}"></div></div>`).join('')}</div>
<div class="track" id="track" onclick="this.dataset.n=(this.dataset.n|0)+1">Slide track</div>
<footer class="sec" id="1666500104"><p id="foot">Footer text © Buff &amp; Beyond</p></footer>
<script>const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in')}));document.querySelectorAll('.fade').forEach(x=>io.observe(x));</script>
</body></html>`;
// Colour contrast cases: a gold form like a real client's (pale placeholders, borders that barely show),
// light gray text, a button with white on yellow, text in a wrapper with no background over its
// parent's photo, and text over an overlay layer that is a sibling, not a parent.
const CONTRAST_PAGE = `<!doctype html><html><head><title>Contrast | Buff &amp; Beyond</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font-family:Arial,sans-serif;color:#222}.ok{padding:30px;background:#fff}
.gold{background:linear-gradient(#b8954a,#7a5f2a);padding:30px;max-width:420px}.gold h2{color:#fff;font-size:30px}
.gold input,.gold textarea{display:block;width:90%;margin:10px 0;padding:12px;font-size:18px;background:transparent;border:2px solid #c4a35a;color:#fff}
.gold input::placeholder{color:#d9c08a}.gold label{color:#fff}
.photo{position:relative;height:300px;background:url('/photo.svg') center/cover}.photo .wrap{position:absolute;top:40px;left:20px;right:20px}.photo p{color:#fff;font-size:16px}
.layered{position:relative;height:200px}.layered .bg{position:absolute;inset:0;background:#f4f4f4}.layered .overlay{position:absolute;inset:0;background:rgba(255,255,255,.6)}
.layered .content{position:relative;padding:40px}.layered .content p{color:#bbb}
.btn{display:inline-block;background:#fc0;color:#fff;padding:12px 20px;text-decoration:none}
</style></head><body>
<div class="ok"><p id="good">This dark text on white is fine.</p><p style="color:#aaa" id="gray">This light gray text is too light.</p><a class="btn" href="#">Book now</a></div>
<div class="gold" id="quote"><h2>GET A QUOTE TODAY</h2><input placeholder="First Name"><input placeholder="Email"><label>Service Interested In</label><textarea></textarea></div>
<div class="photo"><div class="wrap"><p id="overphoto">This is a very long text over a photo with no background of its own.</p></div></div>
<div class="layered"><div class="bg"></div><div class="overlay"></div><div class="content"><p id="sibling">Text over a sibling overlay layer, not a parent.</p></div></div>
</body></html>`;
// Photos: a car interior on the RV page, a photo with a phone watermark, a column background and a
// parallax background (background-attachment: fixed).
const RV_PAGE = `<!doctype html><html><head><title>RV Detailing | Buff &amp; Beyond</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font-family:Arial,sans-serif;color:#222}.sec{padding:40px}.cols{display:flex;gap:20px}.col{flex:1}
.bgcol{min-height:320px;background:url('/photos/shop-bg.png') center/cover;color:#fff;padding:30px}
.para{height:420px;background:url('/photos/parallax-road.png') center/cover fixed;color:#fff;display:flex;align-items:center;justify-content:center;font-size:40px}
</style></head><body><header class="dmHeader"><b>Buff &amp; Beyond</b></header>
<div class="sec"><h1>RV Detailing in Wilmington</h1><p>We wash, polish and protect motorhomes and travel trailers of every size.</p>
<img width="600" height="340" alt="RV detailing" src="/photos/sedan-interior.png"></div>
<div class="sec"><h2>Full RV wash</h2><div class="cols"><div class="col"><p>Roof, sides and awning cleaned by hand. Black streaks removed from the fibreglass.</p>
<img width="500" height="300" alt="RV wash" src="/photos/rv-exterior.png"></div><div class="col bgcol" id="bgcol"><h3>Our shop</h3><p>Indoor bays big enough for a Class A motorhome.</p></div></div></div>
<div class="sec"><h2>Before and after</h2><img width="500" height="300" alt="Before and after" src="/photos/iphone-shot.png"></div>
<div class="para" id="para"><h2>Ready for the road</h2></div>
<div class="sec"><p>Book your RV detail today.</p></div>
</body></html>`;
// Duda's photo gallery, the way a real client's page had it: every picture keeps a caption button labelled
// "Button" with no link; a second "Button" with a link that the page's script hides once it has loaded;
// and a real button somebody forgot to rename.
const GALLERY_PAGE = `<!doctype html><html><head><title>PPF vs Ceramic | Buff &amp; Beyond</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div id="dmcontent"><h1>Paint protection film vs ceramic coating</h1><p>Two of the most talked-about options.</p>
<div class="dmPhotoGallery newPhotoGallery" data-element-type="dPhotoGalleryId" data-widget-type="photoGallery" id="1534393666"><ul class="dmPhotoGalleryHolder">
<li class="photoGalleryThumbs" id="1272254484"><div class="caption-container" id="1926492348"><span class="caption-inner"><h3 class="caption-title"></h3>
<a class="caption-button dmWidget" href="" id="1626888154"><span class="text" id="1889388497">Button</span></a></span></div></li>
<li class="photoGalleryThumbs" id="1903544282"><div class="caption-container" id="1863401669"><span class="caption-inner"><h3 class="caption-title">Beyond Boundaries</h3>
<a class="caption-button dmWidget" href="" id="1233015223"><span class="text" id="1775854035">Button</span></a></span></div></li></ul></div>
<div class="promo" id="promo1"><a class="dmButtonLink" href="/contact" id="2001"><span class="text" id="2002">Button</span></a></div>
<div class="cta" id="cta1"><a class="dmButtonLink" href="/contact" id="3001"><span class="text" id="3002">Button</span></a></div></div>
<script>window.addEventListener('load', () => setTimeout(() => { document.getElementById('promo1').style.display = 'none'; }, 300));</script>
</body></html>`;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const ph = u.pathname.match(/^\/photos\/([\w-]+)\.png$/);
  if (ph && PHOTO_COL[ph[1]]) { res.setHeader('Content-Type', 'image/png'); return res.end(png(ph[1] === 'parallax-road' ? 1200 : 600, ph[1] === 'parallax-road' ? 700 : 360, PHOTO_COL[ph[1]])); }
  if (u.pathname === '/__version') { version = Number(u.searchParams.get('v')); return res.end('ok'); }
  if (u.pathname === '/photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#e8e2d0"/><stop offset="1" stop-color="#20304a"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/></svg>'); }
  if (u.pathname === '/img.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return setTimeout(() => res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#${(Number(u.searchParams.get('i')) * 1234567 % 0xffffff).toString(16).padStart(6, '0')}"/><text x="20" y="100" font-size="30">IMG ${u.searchParams.get('i')}</text></svg>`), 150); }
  const m = u.pathname.match(/^\/site\/abc123(\/.*)?$/);
  if (!m) { res.statusCode = 404; return res.end('nope'); }
  const p = (m[1] || '/').replace(/\/+$/, '') || '/';
  if (p === '/ppf-vs-ceramic') { res.setHeader('Content-Type', 'text/html'); return res.end(GALLERY_PAGE); }
  if (p === '/rv-rentals') { res.setHeader('Content-Type', 'text/html'); return res.end(RV_PAGE); }
  if (p === '/contrast-test') { res.setHeader('Content-Type', 'text/html'); return res.end(CONTRAST_PAGE); }
  if (!['/', '/about'].includes(p)) { res.statusCode = 404; return res.end('<h1>Not found</h1>'); }
  res.setHeader('Content-Type', 'text/html'); res.end(page(p, u.searchParams.get('dm_device')));
}).listen(port, () => console.log('fixture site on ' + port));
