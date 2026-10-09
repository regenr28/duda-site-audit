// The screens a page can be shown on: the live view and the pictures use the same sizes and the
// same browser identity, so what a client marks matches what the team sees.
// (Kept apart from _shoot.js so pages that only need the sizes do not carry the browser with them.)
export const DEVICES = {
  desktop: { w: 1920, h: 1000, dsf: 1, mobile: false, slice: 2000,
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' },
  tablet: { w: 820, h: 1180, dsf: 1.5, mobile: true, slice: 1600,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  mobile: { w: 390, h: 844, dsf: 2, mobile: true, slice: 1400,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
};
