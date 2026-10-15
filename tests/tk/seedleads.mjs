// Seeds a few form submissions for website abc123 into the fake key-value store. node seedleads.mjs <app>
import path from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.KV_REST_API_URL = 'http://127.0.0.1:8078'; process.env.KV_REST_API_TOKEN = 'x';
const { addLeads } = await import(pathToFileURL(path.join(path.resolve(process.argv[2]), 'api/_leads.js')).href);
const d = (n) => new Date(Date.now() - n * 86400000).toISOString();
const n = await addLeads('abc123', [
  { id: 'l1', at: d(40), n: 'Maria Santos', e: 'Maria@Example.com', p: '(302) 555-0101', pg: '/contact', fm: 'Contact', src: 'google/organic', f: { Message: 'Need a quote for ceramic coating' } },
  { id: 'l2', at: d(5), n: 'Maria Santos', e: 'maria@example.com', p: '', pg: '/services', fm: 'Quote', src: 'google/organic', f: { Message: 'Following up on my quote' } },
  { id: 'l3', at: d(3), n: 'M. Santos', e: '', p: '302-555-0101', pg: '/contact', fm: 'Contact', src: 'direct', f: { Message: 'Calling about Saturday' } },
  { id: 'l4', at: d(2), n: 'John Reyes', e: 'john@reyes.co', p: '', pg: '/', fm: 'Contact', src: 'facebook/social', f: { 'How can we help?': 'Window tint for a sedan' } },
  { id: 'l5', at: d(1), n: 'Rank Pro', e: 'sales@rankpro.io', p: '', pg: '/contact', fm: 'Contact', src: '', f: { Message: 'I noticed your website is not on the first page of Google. Our SEO services will rank your website higher: https://rankpro.io' } },
]);
console.log('seeded', n);
