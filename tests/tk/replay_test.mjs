import fs from 'node:fs';
const { shoot } = await import(process.argv[2] + '/api/_shoot.js');
for (const [dev, y] of [['desktop', 4200], ['mobile', 9000]]) {
  const r = await shoot('http://127.0.0.1:8093/site/abc123/?preview=true&dm_device=' + dev, dev,
    { replay: { y, actions: [{ s: '#servBtn' }, { s: '#bookBtn' }], hover: '' } });
  console.log(dev, 'scrollY', r.scrollY, 'h', r.h, 'slices', r.slices.length, r.ms + 'ms');
  r.slices.forEach((s, i) => fs.writeFileSync(`rp-${dev}-${i}.webp`, Buffer.from(s.data, 'base64')));
  const modal = r.els.find((e) => e.t === 'Pick a day that suits you.');
  const menu = r.els.find((e) => e.t === 'Window tint');
  console.log(' modal at', modal && modal.r, ' menu at', menu && menu.r);
}
