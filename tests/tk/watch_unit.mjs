// Unit test for the live content check's page reader (api/_watch.js checkPage / textOf / dueOrder).
const A = process.argv[2];
const W = await import(A + '/api/_watch.js');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

const truth = {
  businessName: 'Shine Pro Detailing', names: ['Shine Pro Detailing'],
  phones: ['2145550100'], emails: ['hello@shinepro.com'],
  addresses: [{ street: '100 Main St', city: 'Dallas', state: 'TX', zip: '75201' }],
  socials: { facebook: ['shineprodetailing'], instagram: ['shinepro'] }, socialLinks: {},
};

// A blog post copied from another detailer: their address, phone, email, Facebook, map and copyright.
const blog = `<html><head><title>Ceramic coating</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"Glossy Garage LLC","telephone":"(469) 555-0199"}</script>
<style>.x{color:red}</style></head><body>
<header><a href="tel:+12145550100">Call (214) 555-0100</a> <a href="mailto:hello@shinepro.com">hello@shinepro.com</a></header>
<article><h1>Why ceramic coating?</h1>
<p>Visit us at 4821 Elm Ridge Rd, Plano, TX 75023 or call <a href="tel:4695550199">469-555-0199</a>.</p>
<p>Questions? Write to <a href="mailto:info@glossygarage.com">info@glossygarage.com</a>.</p>
<p>We proudly serve Frisco, TX 75034 and the area.</p>
<iframe src="https://www.google.com/maps/embed/v1/place?q=4821+Elm+Ridge+Rd+Plano+TX+75023"></iframe>
<a href="https://www.facebook.com/glossygaragetx">Follow Glossy Garage</a>
<a href="https://www.facebook.com/shineprodetailing">Our Facebook</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=https://x.com">Share</a>
<a href="https://www.instagram.com/shinepro/">IG</a>
</article>
<footer><p>100 Main St, Dallas, TX 75201</p><p>© 2024 Glossy Garage LLC. All rights reserved.</p><p>Website design by Detailers Roadmap</p></footer>
<!-- 972-555-0000 in a comment is not visible -->
<script>var t="972-555-1111";</script>
</body></html>`;

const out = W.checkPage(blog, truth, '/blog/ceramic');
const has = (type, re, sev) => out.some((x) => x.type === type && re.test(x.value) && (!sev || x.sev === sev));
ok(has('phone', /469/, 'critical'), 'foreign phone found');
ok(!out.some((x) => x.type === 'phone' && /214/.test(x.value)), 'own phone not flagged');
ok(!out.some((x) => /972/.test(x.value)), 'hidden numbers (comment/script) ignored');
ok(out.filter((x) => x.type === 'phone' && /469/.test(x.value)).length >= 1, 'phone once per page from links/text (schema may add one)');
ok(has('email', /glossygarage/, 'critical'), 'foreign email found');
ok(!has('email', /shinepro/), 'own email not flagged');
ok(has('address', /4821 Elm Ridge/, 'critical'), 'foreign street address critical');
ok(has('address', /Frisco/, 'warning'), 'town+zip without street is a warning');
ok(!has('address', /75201/), 'own address not flagged');
ok(has('social', /glossygaragetx/), 'foreign facebook found');
ok(!has('social', /shineprodetailing|sharer|instagram/), 'own socials and share links not flagged');
ok(has('name', /Glossy Garage/, 'critical'), 'copyright / schema name flagged');
ok(out.some((x) => /schema/.test(x.label) && x.type === 'name'), 'schema name flagged');
ok(out.every((x) => x.path === '/blog/ceramic'), 'path recorded');

// A clean page: nothing.
const clean = `<body><p>Call <a href="tel:214-555-0100">214.555.0100</a> · 100 Main St, Dallas, TX 75201</p><p>© 2025 Shine Pro Detailing</p><p>Powered by Duda</p>
<a href="mailto:Hello@ShinePro.com?subject=Hi">Email</a> <a href="https://facebook.com/ShineProDetailing">fb</a> <a href="https://www.youtube.com/@ShineProDetailing">yt</a></body>`;
const LB = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoWash","name":"Shine Pro Detailing","telephone":"214-555-0100"}</script>';
const c2 = W.checkPage(clean + LB, truth, '/');
ok(c2.length === 0, 'clean page has no findings: ' + JSON.stringify(c2));

// No Business Info phones → phone check skipped (nothing to compare with).
ok(W.checkPage(blog, Object.assign({}, truth, { phones: [] }), '/').every((x) => x.type !== 'phone'), 'no phones in truth → no phone findings');

// "500 happy customers in Plano, TX 75023" is not a street address; a ZIP-keyed finding merges across pages.
const hc = W.checkPage('<p>Over 500 happy customers in Plano, TX 75023</p>', truth, '/about');
ok(hc.length === 1 && hc[0].sev === 'warning' && hc[0].value === 'Plano, TX 75023', 'a number before a town is not a street: ' + JSON.stringify(hc));
ok(W.keyOf({ type: 'address', value: '4821 Elm Ridge Rd, Plano, TX 75023' }) === W.keyOf(hc[0]), 'addresses are known by their ZIP');
// A "Service" schema names the service, not the business: never a business-name finding. Its provider is the business.
const svc = (prov) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"Paint Protection Film"${prov ? `,"provider":{"@type":"LocalBusiness","name":"${prov}"}` : ''}}</script>`;
ok(!W.checkPage(svc(), truth, '/paint-protection-film').some((x) => x.type === 'name'), 'a Service schema is not taken as the business name');
ok(W.checkPage(svc('Joes Auto Spa'), truth, '/ppf').some((x) => x.type === 'name' && /Joes Auto Spa/.test(x.value) && x.sev === 'critical'), 'a Service whose provider is another business is flagged');
ok(!W.checkPage(svc('Shine Pro Detailing'), truth, '/ppf').some((x) => x.type === 'name'), 'a Service provided by this business is fine');
// The home page without Local Business Schema says so (a note, not super critical); with it, nothing.
const noLb = W.checkPage('<p>Welcome</p>' + svc(), truth, '/');
ok(noLb.length === 1 && noLb[0].type === 'schema' && noLb[0].sev === 'warning' && /Local Business Schema not enabled/.test(noLb[0].value), 'home page without Local Business Schema: ' + JSON.stringify(noLb));
ok(!W.checkPage('<p>Welcome</p>', truth, '/services').some((x) => x.type === 'schema'), 'only the home page is checked for it');
ok(!W.checkPage('<p>Welcome</p>' + LB.replace('AutoWash', 'http://schema.org/AutomotiveBusiness'), truth, '/').length, 'a full schema.org type URL counts');
// Lucent Auto Works, as reported: their own email, a schema with two phones, schema named after the page.
const lt = Object.assign({}, truth, { siteDomain: 'www.shinepro.com' });
const own = W.checkPage('<p>Write to <a href="mailto:info@shinepro.com">info@shinepro.com</a> or <a href="mailto:bob@joesautospa.com">bob@joesautospa.com</a></p>', lt, '/about');
ok(own.some((x) => x.type === 'email' && x.value === 'info@shinepro.com' && x.sev === 'warning' && x.verify && /add it to Business Info/.test(x.rec)), 'an email at their own domain: Verify, with what to do');
ok(own.some((x) => x.type === 'email' && x.value === 'bob@joesautospa.com' && x.sev === 'critical'), 'another domain is still super critical');
const two = (tel, name, title) => `<html><head><title>${title || 'Paint Correction Tacoma'}</title><script type="application/ld+json">{"@type":"ProfessionalService","name":"${name || 'Shine Pro Detailing'}","telephone":"${tel}"}</script></head><body><h1>${title || 'Paint Correction Tacoma'}</h1></body></html>`;
const tp = W.checkPage(two('+1-214-555-0100,+1-360-915-6218'), lt, '/paint-correction');
ok(tp.length === 1 && tp[0].type === 'phone' && /360/.test(tp[0].value) && tp[0].sev === 'warning' && tp[0].verify && /personal number/.test(tp[0].rec), 'two phones in one field: theirs is fine, the second is Verify: ' + JSON.stringify(tp));
const tq = W.checkPage(two('+1-360-915-6218'), lt, '/paint-correction');
ok(tq.length === 1 && tq[0].sev === 'critical', 'a schema whose only phone is not theirs stays super critical');
const tn = W.checkPage(two('+1-214-555-0100', '#1 PAINT CORRECTION &amp; VEHICLE POLISHING SERVICES', '#1 Paint Correction &amp; Vehicle Polishing Services'), lt, '/paint-correction');
ok(tn.length === 1 && tn[0].type === 'schema' && tn[0].sev === 'warning' && /page's title/.test(tn[0].label), 'their own schema named after the page is a note, not another business: ' + JSON.stringify(tn));
const tg = W.checkPage(two('', 'Ceramic Pro Gold Package', 'Ceramic Pro Gold Package | Shine Pro'), lt, '/ceramic-pro-gold-package');
ok(tg.length === 1 && tg[0].type === 'schema', 'named like the page title, even without a phone: ' + JSON.stringify(tg));
const tx = W.checkPage(two('', "Joe's Auto Spa", 'Ceramic Coating'), lt, '/ceramic');
ok(tx.length === 1 && tx[0].type === 'name' && tx[0].sev === 'critical', 'another business name in schema is still super critical');
// textOf decodes entities and drops scripts
ok(W.textOf('<p>A &amp; B&nbsp;C</p><script>x</script>') === 'A & B C', 'textOf: ' + JSON.stringify(W.textOf('<p>A &amp; B&nbsp;C</p><script>x</script>')));

// The queue order: republished since last check first, then never checked, then older than 30 days.
const now = Date.parse('2026-10-13T00:00:00Z');
const sites = [
  { id: 'fresh', pub: '2026-10-01T00:00:00Z' },
  { id: 'never', pub: '2026-09-01T00:00:00Z' },
  { id: 'old', pub: '2026-01-01T00:00:00Z' },
  { id: 'repub', pub: '2026-10-12T00:00:00Z' },
];
const sums = { fresh: { at: now - 86400000, pubAt: Date.parse('2026-10-01T00:00:00Z') }, old: { at: now - 40 * 86400000, pubAt: Date.parse('2026-01-01T00:00:00Z') }, repub: { at: now - 5 * 86400000, pubAt: Date.parse('2026-10-01T00:00:00Z') } };
const order = W.dueOrder(sites, sums, now).map((x) => x.id);
ok(JSON.stringify(order) === JSON.stringify(['repub', 'never', 'old']), 'due order ' + order.join(','));

// Flagged a business name under the old rules: read again soon. Same result under the new rules: left alone.
const sums2 = { a: { at: now - 86400000, pubAt: Date.parse('2026-01-01T00:00:00Z'), t: { name: 2 } }, b: { at: now - 86400000, pubAt: Date.parse('2026-01-01T00:00:00Z'), rv: 3, t: { name: 1 } }, c: { at: now - 86400000, pubAt: Date.parse('2026-01-01T00:00:00Z'), t: { phone: 1 } } };
const o2 = W.dueOrder([{ id: 'a', pub: '2026-01-01T00:00:00Z' }, { id: 'b', pub: '2026-01-01T00:00:00Z' }, { id: 'c', pub: '2026-01-01T00:00:00Z' }], sums2, now).map((x) => x.id);
ok(JSON.stringify(o2) === '["a"]', 'only websites with an old-rules business name are read again: ' + o2.join(','));
console.log(fail ? 'SOME FAILED' : 'ALL PASS', out.length, 'findings on the blog page');
if (fail || process.env.SHOW) console.log(JSON.stringify(out, null, 1));
process.exit(fail ? 1 : 0);
