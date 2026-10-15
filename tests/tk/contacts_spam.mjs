// Unit test: contacts flag spam, keep real people, and obey a person's ruling. node contacts_spam.mjs <app>
import path from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.KV_REST_API_URL = 'https://x.test'; process.env.KV_REST_API_TOKEN = 'x';
const { contactsFrom, fakeName } = await import(pathToFileURL(path.join(path.resolve(process.argv[2]), 'api/_leads.js')).href);
let ok = true; const check = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok = ok && !!c; };
const L = (id, n, e, p, msg, at) => ({ id, n, e, p, f: { Message: msg }, at: at || '2026-10-0' + (id % 9 + 1) + 'T10:00:00Z' });
const leads = [
  L(1, 'Maria Santos', 'maria@gmail.com', '0412 345 678', 'How much for ceramic coating on my car this week?'),
  L(2, 'John Seo', 'john@rankfast.io', '', 'I noticed your website is not on the first page of Google. Our SEO services can rank your website higher. https://rankfast.io'),
  L(3, 'uRnFjKqZwX', 'xx12@mail.ru', '', 'hello'),
  L(4, 'Tom Lee', 'tom@lee.com', '0400111222', 'Can I book a tint for Saturday?'),
  L(5, 'Growth Team', 'growth@agency.com', '', 'We are a digital marketing agency offering lead generation service and backlink packages.'),
];
const c = contactsFrom(leads);
const by = (e) => c.find((x) => x.email === e);
check(c.length === 5, 'every sender is still a contact (nothing deleted)');
check(!by('maria@gmail.com').spam && !by('tom@lee.com').spam, 'real customers are people');
check(by('john@rankfast.io').spam && /phrase|Sales/i.test(by('john@rankfast.io').why), 'an SEO pitch is likely spam, with the reason: ' + by('john@rankfast.io').why);
check(by('growth@agency.com').spam, 'an agency pitch is likely spam');
check(by('xx12@mail.ru').spam && /random letters/.test(by('xx12@mail.ru').why), 'keyboard-noise name is likely spam: ' + by('xx12@mail.ru').why);
const ruled = contactsFrom(leads, { 'john@rankfast.io': 'real', 'tom@lee.com': 'junk' });
check(!ruled.find((x) => x.email === 'john@rankfast.io').spam && ruled.find((x) => x.email === 'tom@lee.com').spam, "a person's ruling wins both ways");
check(fakeName('Maria Santos') === '' && fakeName('Nguyen Thi') === '' && fakeName('www.cheap-seo.com') !== '', 'normal names pass, web addresses do not');
check(contactsFrom([Object.assign(L(9, 'Ann', 'ann@x.com', '', 'buy backlink guest post'), { verdict: 'real' })])[0].spam === false, 'a verdict already set by a person on the submission is kept');
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
