// Fake Duda preview pages for the ticket tests. node fixsite.mjs <port>
import http from 'node:http';
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
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__version') { version = Number(u.searchParams.get('v')); return res.end('ok'); }
  if (u.pathname === '/photo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#e8e2d0"/><stop offset="1" stop-color="#20304a"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/></svg>'); }
  if (u.pathname === '/img.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return setTimeout(() => res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#${(Number(u.searchParams.get('i')) * 1234567 % 0xffffff).toString(16).padStart(6, '0')}"/><text x="20" y="100" font-size="30">IMG ${u.searchParams.get('i')}</text></svg>`), 150); }
  const m = u.pathname.match(/^\/site\/abc123(\/.*)?$/);
  if (!m) { res.statusCode = 404; return res.end('nope'); }
  const p = (m[1] || '/').replace(/\/+$/, '') || '/';
  if (p === '/contrast-test') { res.setHeader('Content-Type', 'text/html'); return res.end(CONTRAST_PAGE); }
  if (!['/', '/about'].includes(p)) { res.statusCode = 404; return res.end('<h1>Not found</h1>'); }
  res.setHeader('Content-Type', 'text/html'); res.end(page(p, u.searchParams.get('dm_device')));
}).listen(port, () => console.log('fixture site on ' + port));
