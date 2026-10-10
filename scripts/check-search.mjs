// Keeps search honest. Run before every update:  node scripts/check-search.mjs
//
// 1. Every page and action in the search (SEARCH_ITEMS in public/app.js) must point at a Help page
//    that exists, so "what is…" questions about it have an answer.
// 2. Every page the app can open (route() in public/app.js) must be findable in the search.
// Exits with an error, listing what is missing, when either is not true.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const { HELP_SECTIONS } = await import(pathToFileURL(path.join(root, 'api/_help.js')).href);
const helpIds = new Set(HELP_SECTIONS.map((s) => s.id));
const block = app.slice(app.indexOf('const SEARCH_ITEMS = ['), app.indexOf('];', app.indexOf('const SEARCH_ITEMS = [')));
const items = [...block.matchAll(/label: '((?:[^'\\]|\\.)*)'|label: "([^"]*)"/g)].map((m) => m[1] || m[2]);
const helps = [...block.matchAll(/help: '([^']+)'/g)].map((m) => m[1]);
const searchRoutes = new Set([...block.matchAll(/route: '([^']+)'/g)].map((m) => m[1]));
const problems = [];
if (helps.length !== items.length) problems.push(`${items.length - helps.length} search item(s) have no help: field`);
helps.forEach((h, i) => { if (!helpIds.has(h)) problems.push(`"${items[i]}" points at Help page "${h}", which does not exist`); });
// Pages that are only ever reached from inside another page (one website, one project…).
const INNER = new Set(['site', 'project', 'dr', 'guide', 'my']);
const routes = new Set([...app.matchAll(/if \(parts\[0\] === '([a-z-]+)'/g)].map((m) => m[1]).filter((r) => !INNER.has(r)));
routes.add('sites');
routes.forEach((r) => { if (!searchRoutes.has(r)) problems.push(`the page "#/${r}" can't be found with the search (add it to SEARCH_ITEMS)`); });
if (problems.length) { console.error('Search check FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log(`Search check passed: ${items.length} pages, actions and filters, all with Help pages; all ${routes.size} pages findable.`);
