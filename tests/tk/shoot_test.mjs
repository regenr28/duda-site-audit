import fs from 'node:fs';
const { shoot } = await import(process.argv[2] + '/api/_shoot.js');
for (const dev of ['desktop', 'mobile']) {
  const r = await shoot('http://127.0.0.1:8093/site/abc123/?preview=true&dm_device=' + dev, dev);
  console.log(dev, { w: r.w, h: r.h, full: r.full, slices: r.slices.length, els: r.els.length, links: r.links, title: r.title, ms: r.ms, sizes: r.slices.map((s) => Math.round(s.data.length * 0.75 / 1024) + 'KB') });
  r.slices.forEach((s, i) => fs.writeFileSync(`out-${dev}-${i}.webp`, Buffer.from(s.data, 'base64')));
  console.log(r.els.filter((e) => /open at|Section 3$|Photo 3/.test(e.t)).slice(0, 5));
}
