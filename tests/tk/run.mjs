import { start } from './harness.mjs';
await start();
console.log('READY');
setInterval(() => {}, 1 << 30);
process.on('SIGTERM', async () => { (await import('./harness.mjs')).stop(); process.exit(0); });
