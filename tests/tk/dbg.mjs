import { start, stop, call, redis, CLIENT } from './harness.mjs';
await start();
console.log(await redis(['GET','dsa:site:s1'], ['GET','dsa:user:'+CLIENT]));
const r = await call(CLIENT, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'desktop', path: '/' });
console.log(r.status, r.body);
stop();
