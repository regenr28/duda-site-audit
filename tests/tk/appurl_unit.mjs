// Links in Slack/emails never point at a one-off Vercel deployment address (scheduled runs land there).
// Usage: node appurl_unit.mjs <app>
const APP = process.argv[2];
let ok = true;
const check = (c, label) => { console.log((c ? 'PASS ' : 'FAIL ') + label); ok = ok && !!c; };
delete process.env.APP_URL;
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'duda-site-audit.vercel.app';
const L = await import(APP + '/api/_lib.js');
const req = (host) => ({ headers: { host } });
check(L.isDeploymentHost('duda-site-audit-39fyt678j-8bitcreative.vercel.app') && !L.isDeploymentHost('duda-site-audit.vercel.app') && !L.isDeploymentHost('audit.example.com'), 'a one-off deployment address is told apart from the real ones');
check(L.appUrl(req('duda-site-audit-39fyt678j-8bitcreative.vercel.app')) === 'https://duda-site-audit.vercel.app', 'a scheduled run on a deployment address links to the production address');
check(L.appUrl() === 'https://duda-site-audit.vercel.app', '…and so does a link made with no request at hand');
check(L.appUrl(req('audit.example.com')) === 'https://audit.example.com', 'a person opening the app on its own domain: that domain');
check(L.appUrl(req('duda-site-audit-abc123xyz-8bitcreative.vercel.app')) === 'https://audit.example.com' && L.appUrl() === 'https://audit.example.com', 'after that, a scheduled run keeps using the real address last seen');
process.env.APP_URL = 'https://set.example.com/';
check(L.appUrl(req('duda-site-audit-39fyt678j-8bitcreative.vercel.app')) === 'https://set.example.com', 'APP_URL, when set, always wins');
console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
