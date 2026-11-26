// Link rules without a scan: purpose, redirects followed, verified replacements, one answer per link.
// Usage: node link_unit.mjs <app>
const APP = process.argv[2];
await import(APP + '/public/engine.js');
const A = globalThis.DudaAudit;
let ok = true;
const check = (c, label) => { console.log((c ? 'PASS ' : 'FAIL ') + label); ok = ok && !!c; };
check(A.linkPurpose('PPF packages', '/service/paint-protection-film') === 'packages', '"PPF packages" is a packages link');
check(A.linkPurpose('STEK film options', '/stek-paint-protection-film') === 'brand' && A.linkPurpose('LLumar film details', '/about-llumar-window-tint') === 'brand', 'STEK and LLumar links are brand links');
check(A.linkPurpose('Porsche PPF packages', '/service/porsche-paint-protection-film') === 'vehicle', '"Porsche PPF packages" is a vehicle link');
check(A.linkPurpose('Get a quote', '/contact') === 'lead' && A.linkPurpose('ceramic coating', '/service/vehicle-ceramic-coating') === 'service', 'contact and plain service links');
const pages = [{ path: '/a', redirectTo: '/b' }, { path: '/b', redirectTo: '/c' }, { path: '/c', title: 'C' }, { path: '/loop1', redirectTo: '/loop2' }, { path: '/loop2', redirectTo: '/loop1' },
  { path: '/x', title: 'Window Tinting' }, { path: '/y', title: 'Ceramic' }, { path: '/gone', notFound: true }];
const byPath = new Map(pages.map((p) => [p.path, p]));
check(A.finalPage('/a', byPath) === '/c', 'a redirect chain is followed to where it lands');
check(['/loop1', '/loop2'].includes(A.finalPage('/loop1', byPath)), 'a redirect loop stops (it is reported by the redirect checks)');
const links = [{ text: 'heat control', to: '/y', pages: ['/p'], selector: '#l1', location: 'Body' }, { text: 'tips', to: '/y', pages: ['/p'], selector: '#l2', location: 'Body' }];
const town = { code: 'LINK_TOWN_SERVICE', severity: 'info', selector: '#l1', path: '/p', pages: ['/p'], found: 'x', id: 't1' };
const other = { code: 'LINK_TOWN_SERVICE', severity: 'info', selector: '#l9', path: '/p', pages: ['/p'], found: 'y', id: 't2' };
const broken = { code: 'LINK_BROKEN_INTERNAL', severity: 'critical', selector: '#l1', path: '/p', found: '/gone', id: 'b1' };
const out = A.applyLinkVerdicts([town, other, broken], links, [{ i: 0, verdict: 'wrong_page', confidence: 0.9, reason: 'r', expected: '/x' }, { i: 1, verdict: 'wrong_page', confidence: 0.9, reason: 'r', expected: '/gone' }], pages);
check(out.some((f) => f.code === 'LINK_WRONG_PAGE' && f.selector === '#l1' && /\/x/.test(f.expected)) && !out.some((f) => f.id === 't1'), 'a wrong-page answer replaces the town idea on the same link (one answer per link)');
check(out.some((f) => f.id === 't2') && out.some((f) => f.id === 'b1'), 'other links’ items and broken-link items are untouched');
const g = out.find((f) => f.code === 'LINK_WRONG_PAGE' && f.selector === '#l2');
check(g && !/\/gone/.test(g.expected) && g.clarify, 'a suggested page that does not work is never offered; the item asks to be confirmed');
const opt = A.applyLinkVerdicts([], [{ text: 'film for heat', to: '/y', pages: ['/p'], selector: '#l3' }], [{ i: 0, verdict: 'wrong_page', confidence: 0.9, reason: 'r', expected: '/x', optional: true }], pages);
check(opt[0] && opt[0].severity === 'info' && opt[0].optional && /^Optional/.test(opt[0].message), 'an optional alternative is Info, and says so');
const sec = A.applyLinkVerdicts([], [{ text: 'VIEW PACKAGES', to: '/p', pages: ['/p'], selector: '#b', anchor: { found: true, text: 'Packages' }, frag: 'Pk' }], [{ i: 0, verdict: 'wrong_page', confidence: 0.95, reason: 'same page', expected: '/x' }], pages);
check(!sec.length, 'a button to a section of its own page that is there is never sent elsewhere');
const self = A.applyLinkVerdicts([], [{ text: 'machinery', to: '/y', pages: ['/'], selector: '#m' }, { text: 'more', to: '/y', pages: ['/'], selector: '#n' }],
  [{ i: 0, verdict: 'wrong_page', confidence: 0.85, reason: 'title names another town', expected: '/y' }, { i: 1, verdict: 'wrong_page', confidence: 0.9, reason: 'should open the packages section', expected: '/y#packages' }], pages);
check(!self.some((f) => f.selector === '#m'), '#2256: a "fix" equal to the page the link already opens is refused (no item)');
check(self.some((f) => f.selector === '#n'), '…but another section of that page (#packages) is a different place, so that answer is kept');
check(A.normalizePath('/service/automotive-detailing#FullVehicleDetailingPackages') === '/service/automotive-detailing' && A.normalizePath('/a?b=1') === '/a', 'page addresses stay the same everywhere else (fragment and query dropped)');
console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
