/* Demo mode: the whole app with every real business, person and contact detail swapped for a made-up one,
 * so it can be shown to a prospect (a "show and tell") without exposing any client.
 *
 * Turn on:  open the app with ?demo=1 (e.g. https://audits.8bitcreative.com/?demo=1), or the 🎭 Demo mode
 *           button in your profile, or the search box ("demo mode").
 * Turn off: the Exit button on the demo bar, or ?demo=0. It also ends by itself after 8 hours.
 *
 * How it works, in one place so the rest of the app doesn't need to know:
 *  1. Every answer from the server passes through harvest(): business names, people, emails, phones,
 *     website addresses and street addresses are learnt from it, each given a stable made-up twin
 *     ("Harker Heights Ceramic Coatings" is always "Summit Auto Spa" in this browser).
 *  2. A watcher rewrites the page as it is drawn: text, tooltips, links, alt text, input values,
 *     the tab title, pop-up notifications and anything copied to the clipboard. Emails, phone numbers
 *     and website addresses are also caught by their shape, even ones never seen in an answer.
 *  3. Pictures (team photos, screenshots, website previews) are blurred; comment and ticket text is hidden.
 *  4. It is view-only: anything that would save a change is refused, so a made-up name can never be
 *     saved over a real one.
 * Only the signed-in person's own browser is affected. Nothing changes on the server.
 */
(function () {
  'use strict';
  const KEY = 'dsa-demo';
  const HOURS = 8;

  // ---------- on / off ----------
  function readOn() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.has('demo')) {
        const v = q.get('demo');
        if (v === '0' || v === 'off') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, String(Date.now() + HOURS * 3600e3));
        q.delete('demo');
        const s = q.toString();
        history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
      }
      const until = Number(localStorage.getItem(KEY) || 0);
      if (until && until < Date.now()) { localStorage.removeItem(KEY); return false; }
      return until > 0;
    } catch (e) { return false; }
  }
  const ON = readOn();
  function setOn(v) {
    try { if (v) localStorage.setItem(KEY, String(Date.now() + HOURS * 3600e3)); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  // ---------- made-up twins ----------
  const hash = (s) => { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (list, h) => list[h % list.length];
  const BIZ_A = ['Summit', 'Apex', 'Lakeside', 'Ironwood', 'Redline', 'Northgate', 'Crescent', 'Bluewater', 'Granite', 'Silverline', 'Harbor', 'Copperfield', 'Westbrook', 'Pinecrest', 'Stonebridge', 'Riverbend', 'Highland', 'Oakridge', 'Cedar Point', 'Brightwater', 'Falcon', 'Evergreen', 'Sterling', 'Horizon', 'Canyon', 'Prairie', 'Coastal', 'Liberty', 'Trailhead', 'Mesa', 'Juniper', 'Keystone', 'Bayview', 'Foxglove', 'Ridgeway', 'Willow Creek'];
  const BIZ_B = ['Auto Spa', 'Detailing', 'Ceramic Studio', 'Tint & Wrap', 'Auto Care', 'Paint Protection', 'Detail Co.', 'Car Care', 'Coating Co.', 'Auto Salon', 'Motor Club', 'Detail Garage', 'Auto Studio', 'Shine Studio'];
  const FIRST = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Parker', 'Rowan', 'Skyler', 'Drew', 'Reese', 'Cameron', 'Logan', 'Sam', 'Hayden', 'Emerson', 'Finley', 'Dakota', 'Elliot', 'Harper', 'Kendall'];
  const LAST = ['Rivera', 'Lee', 'Brooks', 'Hayes', 'Carter', 'Bennett', 'Foster', 'Reed', 'Ellis', 'Grant', 'Hughes', 'Price', 'Ward', 'Cole', 'Lane', 'Shaw', 'Wells', 'Porter', 'Bishop', 'Fleming'];
  const CITY = ['Fairview', 'Riverton', 'Lakewood', 'Maple Grove', 'Brookside', 'Pine Hill', 'Cedar Falls', 'Oak Park', 'Westfield', 'Millbrook', 'Ashford', 'Glenwood'];
  const STREET = ['Oak', 'Elm', 'Maple', 'Pine', 'Cedar', 'Birch', 'Willow', 'Aspen', 'Hickory', 'Walnut'];
  const ST_KIND = ['St', 'Ave', 'Rd', 'Blvd', 'Dr', 'Ln'];
  // Our own names, replaced everywhere, in every spelling.
  const AGENCIES = [
    [['Detailers Roadmap', 'DetailersRoadmap', 'Detailer Roadmap'], 'Northstar Growth'],
    [['8bit Creative', '8bitcreative', '8 Bit Creative', '8-bit Creative', '8bit Creative Workspace'], 'Pixelworks Agency'],
  ];
  const AGENCY_DOMAINS = { '8bitcreative.com': 'pixelworks.example', 'detailersroadmap.com': 'northstargrowth.example' };
  // Websites that are nobody's secret: left as they are.
  const KEEP_HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.page|gstatic\.com|googleapis\.com|facebook\.com|fb\.com|instagram\.com|yelp\.com|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|twitter\.com|x\.com|pinterest\.com|duda\.co|multiscreensite\.com|cdn-website\.com|dudamobile\.com|dudaone\.com|vercel\.app|vercel\.com|github\.com|slack\.com|example\.[a-z]+|example|schema\.org|w3\.org|apple\.com|bing\.com|microsoft\.com|wikipedia\.org|cloudflare\.com|gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com|aol\.com|anthropic\.com|claude\.ai|openai\.com|supabase\.co|upstash\.io)$/i;
  // Social profiles: the website is public, the handle names the business.
  const SOCIAL_HOST = /(^|\.)(facebook\.com|fb\.com|instagram\.com|yelp\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.com|linkedin\.com|youtube\.com)$/i;
  const FREE_MAIL = /^(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com|aol\.com|live\.com|me\.com|msn\.com|proton\.me|protonmail\.com)$/i;

  const used = new Set();
  const twins = new Map();          // kind|normalised real → fake
  function twin(kind, real, make) {
    const k = kind + '|' + String(real).toLowerCase().replace(/[^a-z0-9@.]+/g, '');
    if (twins.has(k)) return twins.get(k);
    let f = '', salt = 0;
    do { f = make(hash(k + (salt ? '#' + salt : ''))); salt++; } while (used.has(kind + '|' + f) && salt < 40);
    used.add(kind + '|' + f); twins.set(k, f);
    return f;
  }
  // One business, one made-up name, whatever the spelling: "Coatings", "Coating", "Coatings LLC" are the
  // same shop. A plural slip stays a visible slip ("Summit Auto Spa" / "Summit Auto Spas"), so an audit
  // item about the name still makes sense in a demo.
  const bizBase = (n) => String(n).replace(/[\s,]+(llc|l\.l\.c\.|inc|co|corp|ltd|company)\.?$/i, '').replace(/([^s])s$/i, '$1');
  const pluralOf = (n) => /[^s]s$/i.test(String(n).replace(/[\s,]+(llc|l\.l\.c\.|inc|co|corp|ltd|company)\.?$/i, ''));
  function fakeBiz(n) {
    const base = twin('biz', bizBase(n), (h) => `${pick(BIZ_A, h)} ${pick(BIZ_B, h >>> 8)}`);
    const official = bizOfficial.get(squash(bizBase(n)));
    // Only the spelling that differs from the business's main one gets the extra "s".
    return official !== undefined && pluralOf(n) !== official ? base.replace(/\.$/, '') + 's' : base;
  }
  const bizOfficial = new Map();   // base → is the main spelling plural?
  const fakePerson = (n) => twin('person', n, (h) => `${pick(FIRST, h)} ${pick(LAST, h >>> 8)}`);
  const fakeFirst = (n) => twin('first', n, (h) => pick(FIRST, h));
  const fakeCity = (n) => twin('city', n, (h) => pick(CITY, h));
  const fakeStreet = (n) => twin('street', n, (h) => `${100 + (h % 8900)} ${pick(STREET, h >>> 7)} ${pick(ST_KIND, h >>> 13)}`);
  const fakeZip = (n) => twin('zip', n, (h) => '0' + String(1000 + (h % 8999)));
  const slugOf = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  function fakeHost(host) {
    host = String(host).toLowerCase();
    const www = host.startsWith('www.') ? 'www.' : '';
    const bare = host.replace(/^www\./, '');
    if (AGENCY_DOMAINS[bare]) return www + AGENCY_DOMAINS[bare];
    const sub = bare.split('.'); const reg = sub.slice(-2).join('.');
    if (AGENCY_DOMAINS[reg]) return www + sub.slice(0, -2).map((x) => twin('sub', x, (h) => pick(['app', 'portal', 'hub', 'tools'], h))).concat(AGENCY_DOMAINS[reg]).join('.');
    // A website we know the owner of takes its owner's made-up name.
    const owner = hostOwner.get(bare) || hostOwner.get(reg);
    return www + twin('host', bare, (h) => slugOf(owner ? fakeBiz(owner) : `${pick(BIZ_A, h)} ${pick(BIZ_B, h >>> 8)}`) + '.example');
  }
  function fakeEmail(email) {
    const [local, domain] = String(email).toLowerCase().split('@');
    const who = emailOwner.get(String(email).toLowerCase());
    const dom = FREE_MAIL.test(domain) ? domain : fakeHost(domain);
    const loc = who ? fakePerson(who).toLowerCase().replace(/[^a-z]+/g, '.')
      : /^(info|contact|sales|hello|office|admin|support|service|team|booking|bookings|appointments|quotes?|noreply|no-reply)$/.test(local) ? local
      : twin('local', email, (h) => `${pick(FIRST, h)}.${pick(LAST, h >>> 8)}`.toLowerCase());
    return made(loc + '@' + dom);
  }
  const fakePhone = (digits) => made(twin('phone', digits, (h) => `(555) 555-01${String(h % 100).padStart(2, '0')}`));
  // Everything made up is remembered, so a second pass over the page never rewrites it again.
  const madeUp = new Set();
  function made(s) { madeUp.add(s); return s; }

  // ---------- learning what is secret ----------
  const names = new Map();          // lower-case real → { kind, real }
  const compactNames = new Map();   // letters and digits only → the same
  const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hostOwner = new Map();      // host → business name
  const emailOwner = new Map();     // email → person name
  let rx = null;
  const add = (kind, v) => {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    if (v.length < 4 || v.length > 90 || /@|https?:|^[-\w]+\.(com|net|org|co|us)$/i.test(v) || (kind !== 'zip' && /^\d+$/.test(v))) return;
    if (kind === 'biz' && !/[a-z]/i.test(v)) return;
    const k = v.toLowerCase();
    if (names.has(k)) return;
    put(k, { kind, real: v });
    if (kind === 'biz') {
      if (!bizOfficial.has(squash(bizBase(v)))) bizOfficial.set(squash(bizBase(v)), pluralOf(v));
      // "Ceramic Coatings" and "Ceramic Coating" are the same business.
      const sing = v.replace(/([^s])s$/i, '$1');
      if (sing !== v && sing.length >= 4 && !names.has(sing.toLowerCase())) put(sing.toLowerCase(), { kind, real: sing });
      const bare = v.replace(/[\s,]+(llc|inc|co|corp|ltd|company)\.?$/i, '');
      if (bare !== v && bare.length >= 4 && !names.has(bare.toLowerCase())) put(bare.toLowerCase(), { kind, real: v });
    }
    if (kind === 'person') {
      const first = v.split(' ')[0];
      if (first.length >= 4 && v.includes(' ') && !names.has(first.toLowerCase())) put(first.toLowerCase(), { kind: 'first', real: first });
    }
  };
  function put(k, hit) { names.set(k, hit); if (!compactNames.has(squash(k))) compactNames.set(squash(k), hit); rx = null; }
  AGENCIES.forEach(([forms]) => forms.forEach((f) => put(f.toLowerCase(), { kind: 'agency', real: f })));
  const agencyFake = (real) => { const a = AGENCIES.find(([forms]) => forms.some((f) => f.toLowerCase() === real.toLowerCase())); return a ? a[1] : real; };

  const BIZ_KEYS = /^(businessName|business_name|business|company|companyName|customer|customerName|clientName|siteName|shopName|foreignName|brand|legalName|label)$/;
  const PERSON_KEYS = /^(byName|authorName|userName|assigneeName|holderName|fromName|ownerName|sentByName|takenByName|whoName|displayName|fullName|contactName|firstName_lastName)$/;
  const HOST_KEYS = /^(host|domain|siteDomain|site_domain|customDomain|liveDomain|publicDomain)$/;
  const looksEmail = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
  function harvest(data, depth = 0, parent = null) {
    if (!ON || data == null || depth > 9) return;
    if (Array.isArray(data)) { for (let i = 0; i < data.length && i < 6000; i++) harvest(data[i], depth + 1, parent); return; }
    if (typeof data !== 'object') return;
    const o = data;
    const bizName = typeof o.businessName === 'string' ? o.businessName : '';
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'string') {
        if (BIZ_KEYS.test(k) && k !== 'label') add('biz', v);
        else if (k === 'label' && (o.address || o.phones)) add('biz', v);
        else if (PERSON_KEYS.test(k)) add('person', v);
        else if (HOST_KEYS.test(k) && /\./.test(v)) { const h = v.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase(); if (bizName) hostOwner.set(h.replace(/^www\./, ''), bizName); }
        else if ((k === 'street' || k === 'address1' || k === 'street1' || k === 'streetAddress' || k === 'addressSeen') && v.length >= 5) add('street', v);
        else if ((k === 'city' || k === 'addressLocality') && (o.street || o.zip || o.region || o.zip_code || o.postal_code || o.streetAddress)) add('city', v);
        else if (/^(zip|zip_code|postal_code|postalCode)$/.test(k) && /^\d{5}(-\d{4})?$/.test(v)) add('zip', v);
        else if (k === 'name') {
          if (typeof o.email === 'string' && looksEmail(o.email)) { add('person', v); emailOwner.set(o.email.toLowerCase(), v); }
          else if (o.siteId || o.dudaId || o.host || o.domain || o.sites || o.phase || o.businessName || o.phones || o.location_data) add('biz', v);
        }
      } else if (k === 'names' && Array.isArray(v) && (bizName || o.phones)) v.forEach((n) => typeof n === 'string' && add('biz', n));
      else if (v && typeof v === 'object') harvest(v, depth + 1, o);
    }
  }

  // ---------- rewriting text ----------
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const EMAIL = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
  const TLD = 'com|net|org|co|us|biz|info|io|app|ca|au|nz|uk|site|shop|auto|car|cars|pro|me|tv|online|store|xyz|services|works|express';
  const URL = `(?:https?:\\/\\/)?(?:[A-Za-z0-9-]+\\.)+(?:${TLD})(?![A-Za-z0-9-])(?:\\/[^\\s"'<>)\\]]*)?`;
  const PHONE = '(?<![\\d$.,])(?:\\+?1[\\s.-]?)?\\(?[2-9]\\d{2}\\)?[\\s.-]{0,2}\\d{3}[\\s.-]\\d{4}(?!\\d)';
  function build() {
    const keys = [...names.keys()].sort((a, b) => b.length - a.length).slice(0, 4000);
    // Spaces in a name also match no space, a dash or an underscore: "harker-heights", "HarkerHeights".
    const alt = keys.map((k) => esc(k).replace(/\\?[’']/g, "['’]?").replace(/ /g, '[\\s_-]*')).join('|');
    rx = new RegExp(`(${EMAIL})|(${URL})|(?<![A-Za-z0-9])(${alt || '(?!)'})(?![A-Za-z0-9])|(${PHONE})`, 'gi');
  }
  // "HARKER HEIGHTS" stays in capitals, "harkerheights" (an address or a file name) stays one lower-case word.
  const caseLike = (orig, fake) => (orig === orig.toUpperCase() && /[A-Z]/.test(orig) ? fake.toUpperCase()
    : !/[A-Z\s]/.test(orig) && /[a-z]/.test(orig) && orig.length > 3 && /^[a-z0-9_-]+$/.test(orig) && fake.includes(' ') ? slugOf(fake) : fake);
  function nameFake(m) {
    const hit = names.get(m.toLowerCase().replace(/[\s_-]+/g, ' ').replace(/’/g, "'")) || compactNames.get(squash(m));
    if (!hit) return m;
    const f = hit.kind === 'agency' ? agencyFake(hit.real) : hit.kind === 'biz' ? fakeBiz(hit.real) : hit.kind === 'person' ? fakePerson(hit.real)
      : hit.kind === 'first' ? fakeFirst(hit.real) : hit.kind === 'city' ? fakeCity(hit.real) : hit.kind === 'street' ? fakeStreet(hit.real) : hit.kind === 'zip' ? fakeZip(hit.real) : m;
    return caseLike(m, f);
  }
  function censor(s) {
    if (!ON || s == null) return s;
    s = String(s);
    if (!s || !/[A-Za-z0-9]/.test(s)) return s;
    if (!rx) build();
    rx.lastIndex = 0;
    return s.replace(rx, (m, em, url, nm, ph) => {
      if (madeUp.has(m)) return m;
      if (em) return fakeEmail(em);
      if (url) {
        const mm = url.match(/^(https?:\/\/)?([^/]+)(.*)$/);
        const host = mm[2];
        if (SOCIAL_HOST.test(host)) return made((mm[1] || '') + host + (mm[3] || '').replace(/^\/([^/?#]+)/, (x, h) => (/^(pages|p|profile\.php|groups|biz|in|company|channel|c|user|watch|maps|search|share|reel|reels|stories)$/i.test(h) ? x : '/' + twin('handle', h, (n) => slugOf(`${pick(BIZ_A, n)}${pick(BIZ_B, n >>> 8)}`)))));
        if (KEEP_HOST.test(host)) return url;
        return (mm[1] || '') + fakeHost(host) + (mm[3] ? censorPath(mm[3]) : '');
      }
      if (nm) return nameFake(nm);
      if (ph) return fakePhone(ph.replace(/\D/g, '').slice(-10));
      return m;
    });
  }
  // Inside a web address, only names are swapped (a path has no emails or other websites in it).
  function censorPath(p) {
    if (!names.size) return p;
    if (!rx) build();
    return p.replace(rx, (m, em, url, nm) => (nm ? slugOf(nameFake(nm)) : m));
  }

  // ---------- the page ----------
  const HIDE_TEXT = '.c-body, .cmt-text, .tk-d-text, .quote, .sg-card .c-body, .tk-msg-text';
  const ATTRS = ['title', 'alt', 'placeholder', 'aria-label', 'href', 'data-copy', 'data-tip', 'data-who'];
  let busy = false;
  function fixText(node) {
    const v = node.nodeValue;
    if (!v || v.length < 3) return;
    const p = node.parentElement;
    if (p && (p.closest('script, style, [data-demo-keep]'))) return;
    const c = censor(v);
    if (c !== v) node.nodeValue = c;
  }
  function fixEl(el) {
    if (el.nodeType !== 1 || el.hasAttribute('data-demo-keep')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length >= 3 && !(a === 'href' && /^(#|\/(?!\/))/.test(v))) { const c = a === 'href' ? censorHref(v) : censor(v); if (c !== v) el.setAttribute(a, c); }
    }
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'password' && el.value && !el.dataset.demoTyped) {
      const c = censor(el.value);
      if (c !== el.value) { el.value = c; el.readOnly = true; el.dataset.demoCensored = '1'; }
    }
    if (el.matches && el.matches(HIDE_TEXT) && !el.dataset.demoHidden) {
      el.dataset.demoHidden = '1';
      el.textContent = 'Comment text hidden in demo mode';
      el.classList.add('demo-hidden-text');
    }
    // Initials in a coloured circle are worked out from the real name: work them out from the made-up one.
    if (el.classList && el.classList.contains('av') && !el.classList.contains('av-img') && el.title) {
      const ini = el.title.split(/\s+/).map((x) => x[0] || '').join('').slice(0, 2).toUpperCase();
      if (ini && el.textContent !== ini) el.textContent = ini;
    }
  }
  function censorHref(h) {
    if (/^mailto:/i.test(h)) return 'mailto:' + censor(h.slice(7));
    if (/^tel:/i.test(h)) { const d = h.replace(/\D/g, '').slice(-10); return d.length === 10 ? 'tel:' + fakePhone(d).replace(/\D/g, '') : h; }
    if (/^sms:/i.test(h)) return 'sms:' + fakePhone(h.replace(/\D/g, '').slice(-10)).replace(/\D/g, '');
    return censor(h);
  }
  function sweep(root) {
    if (!root) return;
    if (root.nodeType === 3) return fixText(root);
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest('script, style')) return;
    // Hidden comment text first, so its words are never rewritten one by one.
    if (root.matches && root.matches(HIDE_TEXT)) { fixEl(root); return; }
    root.querySelectorAll && root.querySelectorAll(HIDE_TEXT).forEach(fixEl);
    fixEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) fixText(n); else fixEl(n); }
  }
  function run(muts) {
    if (busy) return;
    busy = true;
    try {
      if (!muts) sweep(document.body);
      else for (const m of muts) {
        if (m.type === 'characterData') fixText(m.target);
        else if (m.type === 'attributes') fixEl(m.target);
        else m.addedNodes.forEach(sweep);
      }
      const t = censor(document.title); if (t !== document.title) document.title = t;
    } finally { busy = false; }
  }

  // ---------- view-only ----------
  let lastToast = 0;
  function say(msg) {
    const t = document.getElementById('toast'); if (!t || Date.now() - lastToast < 1500) return;
    lastToast = Date.now(); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800);
  }
  // Calls that only read, or only tick "seen": allowed, or answered quietly.
  const READS = [/^\/api\/pulse/, /^\/api\/check/, /^\/api\/social/, /^\/api\/auth/];
  const READ_OPS = new Set(['preview', 'logout', 'me', 'help', 'test']);
  const QUIET_OPS = new Set(['seen', 'opened', 'read', 'checked', 'busy', 'seclog', 'presence', 'thumb']);
  /** true = go ahead; otherwise the answer to give instead, or an error is thrown. */
  function allowWrite(path, body) {
    if (!ON) return true;
    let op = ''; try { op = (JSON.parse(body || '{}') || {}).op || ''; } catch (e) { /* not JSON */ }
    if (/^\/api\/auth/.test(path)) return op === 'logout' || op === 'me' || !op ? true : refuse();
    if (READS.some((r) => r.test(path)) || READ_OPS.has(op)) return true;
    if (QUIET_OPS.has(op)) return { ok: true, demo: true };
    return refuse();
  }
  function refuse() {
    say('Demo mode is view-only: nothing is saved. Exit demo mode to make changes.');
    throw Object.assign(new Error('Demo mode is view-only'), { status: 409, demo: true });
  }

  // ---------- start ----------
  function start() {
    document.documentElement.classList.add('demo-mode');
    const bar = document.createElement('div');
    bar.className = 'demo-bar'; bar.setAttribute('data-demo-keep', '');
    bar.innerHTML = '<span>🎭 <b>Demo mode</b><span class="demo-more">: every business, person and contact detail is made up, pictures are blurred, and nothing can be saved.</span></span><button type="button" id="demoExit">Exit demo</button>';
    document.body.appendChild(bar);
    bar.querySelector('#demoExit').onclick = () => setOn(false);
    run();
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['class']) });
    // Copying, notifications and downloads carry the made-up words too.
    try {
      const cw = navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText.bind(navigator.clipboard);
      if (cw) navigator.clipboard.writeText = (t) => cw(censor(t));
    } catch (e) { /* ignore */ }
    document.addEventListener('copy', (e) => { const s = String(document.getSelection() || ''); if (s && e.clipboardData) { e.clipboardData.setData('text/plain', censor(s)); e.preventDefault(); } }, true);
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[download]');
      if (a) { e.preventDefault(); e.stopPropagation(); say('Downloads are off in demo mode: they would contain the real details.'); }
    }, true);
    // Typing in a search box is the viewer's own words: leave them.
    document.addEventListener('input', (e) => { if (e.target && e.target.dataset) e.target.dataset.demoTyped = '1'; }, true);
    if (window.Notification) {
      const N = window.Notification;
      const Wrapped = function (title, opts) { return new N(censor(title), Object.assign({}, opts, opts && opts.body ? { body: censor(opts.body) } : {})); };
      Wrapped.prototype = N.prototype; Object.defineProperty(Wrapped, 'permission', { get: () => N.permission }); Wrapped.requestPermission = N.requestPermission.bind(N);
      window.Notification = Wrapped;
    }
    // Same for the browser tab's own title, set straight on document.title by the app.
    setInterval(() => { const t = censor(document.title); if (t !== document.title) document.title = t; }, 1000);
  }
  if (ON) {
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  window.DemoMode = { on: () => ON, toggle: () => setOn(!ON), set: setOn, harvest, censor, allowWrite, _names: names };
})();
