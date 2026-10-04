// Is this enquiry a customer, or somebody selling to the business?
//
// Three tiers, cheapest first, and most submissions never reach the last one:
//   1. what the team has taught it — a phrase or a sender they have already ruled on;
//   2. rules, which catch the bulk, because this kind of pitch is remarkably formulaic;
//   3. the AI, for what is genuinely unclear — and only then.
//
// Nothing is ever deleted or hidden on the strength of a verdict. A false negative wastes somebody a
// minute; a false positive loses a job the shop never hears about. Those costs are not close, so
// everything here leans towards calling an enquiry real and letting a human disagree.

/** Phrases that belong to somebody selling, not somebody buying. */
const PITCH = [
  'seo audit', 'seo services', 'search engine optimi', 'first page of google', 'rank your website', 'rank higher',
  'backlink', 'guest post', 'link building', 'domain authority', 'increase your traffic', 'drive more traffic',
  'web design services', 'website redesign offer', 'i came across your website', 'i was browsing your website',
  'i noticed your website', 'i stumbled upon your', 'checked your website and found', 'free audit', 'no obligation quote for our',
  'digital marketing agency', 'lead generation service', 'we can help you get more', 'boost your sales',
  'outsourcing', 'offshore', 'dedicated developers', 'hire our team', 'white label', 'reseller',
  'crypto', 'bitcoin', 'forex', 'investment opportunity', 'loan offer',
  'dear sir/madam', 'dear sir or madam', 'to whom it may concern', 'business proposal',
  'unsubscribe', 'this is not spam', 'i am reaching out to you',
];
/** Words a real customer of a detailing or tinting shop uses, and a seller almost never does. */
const CUSTOMER = [
  'quote', 'price', 'how much', 'cost', 'book', 'booking', 'appointment', 'available', 'availability',
  'my car', 'my truck', 'my van', 'my suv', 'vehicle', 'windows', 'tint', 'tinted', 'ceramic', 'coating',
  'detail', 'detailing', 'wash', 'wax', 'polish', 'paint', 'scratch', 'ppf', 'wrap', 'interior', 'exterior',
  'drop off', 'come in', 'this week', 'next week', 'saturday', 'weekend',
];
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Everything the enquirer actually typed, as one string. */
export function bodyOf(lead) {
  const f = lead.fields || lead.f || {};
  return norm(Object.values(f).join(' \n '));
}

/**
 * The rules. Returns { verdict, why, sure } — `sure` meaning no second opinion is needed.
 *
 * A verdict of 'unsure' is not a failure: it is the honest answer for a three-word message, and it
 * is what the AI gets asked about.
 */
export function judgeByRules(lead, ctx = {}) {
  const body = bodyOf(lead);
  const hit = PITCH.filter((p) => body.includes(p));
  const wants = CUSTOMER.filter((w) => body.includes(w));
  const hasUrl = URL_RE.test(body);

  // The same message sent to several different clients. One shop sees an odd email; we see it forty
  // times, and that is as close to proof as this gets — but it must not overrule somebody plainly
  // asking for work. Two customers can phrase a request identically; a blast cannot ask for a quote
  // on its own car. So spread convicts only when the message is also selling, or asking for nothing.
  const across = ctx.sameAcross || 0;
  if (across >= 2 && hit.length) {
    return { verdict: 'junk', why: `${hit[0]} — and the same message went to ${across} different websites`, sure: true };
  }
  if (across >= 3 && !wants.length) {
    return { verdict: 'junk', why: `The same message was sent to ${across} different websites`, sure: true };
  }
  if (hit.length >= 2) return { verdict: 'junk', why: `Sales phrases: ${hit.slice(0, 3).join(', ')}`, sure: true };
  if (hit.length === 1 && hasUrl) return { verdict: 'junk', why: `Sales phrase "${hit[0]}" and a link in the message`, sure: true };
  if (hit.length === 1 && !wants.length) return { verdict: 'junk', why: `Sales phrase "${hit[0]}", and nothing a customer would ask for`, sure: false };

  // A customer almost never links anywhere. A seller nearly always does.
  if (hasUrl && !wants.length && body.length > 120) return { verdict: 'junk', why: 'A link, and nothing a customer would ask for', sure: false };

  if (wants.length >= 2) return { verdict: 'real', why: `Asks about ${wants.slice(0, 3).join(', ')}`, sure: true };
  if (wants.length === 1 && !hasUrl) return { verdict: 'real', why: `Asks about ${wants[0]}`, sure: true };
  // Short and plain — "how much?" with a phone number — is a customer being brief, not a pitch.
  if (!hasUrl && body.length <= 60 && (lead.phone || lead.p)) return { verdict: 'real', why: 'Short message with a contact number', sure: true };
  return { verdict: 'unsure', why: '', sure: false };
}

/** What the AI is asked. Short on purpose: the long tail is what costs. */
export const JUDGE_SYSTEM = `You sort enquiries sent through a car detailing or window tinting shop's website contact form.
"customer" = the sender wants work done on their own vehicle: a quote, a price, a booking, a question about a service.
"pitch" = the sender is selling something TO the business: SEO, web design, marketing, development, backlinks, outsourcing, finance, or any other service for the shop itself.
"unclear" = genuinely impossible to tell. Use it sparingly.
A short or badly written message from somebody who wants their car done is a customer.
Reply with JSON only: {"results":[{"i":1,"verdict":"customer","why":"wants a ceramic coating quote"}]}
One entry per numbered enquiry. "why" is at most eight words.`;

/** The AI's answer for one enquiry, read back. Anything unrecognisable stays unsure, not guessed. */
export function readJudgement(verdict, why) {
  const t = String(verdict || '').trim().toLowerCase();
  const reason = String(why || '').trim().slice(0, 80);
  if (t === 'customer') return { verdict: 'real', why: reason || 'Reads as a customer' };
  if (t === 'pitch') return { verdict: 'junk', why: reason || 'Reads as a pitch to the business' };
  return { verdict: 'unsure', why: '' };
}

/**
 * The fingerprint of what somebody typed, with the things that change between sends taken out.
 *
 * Names, numbers, addresses and URLs vary across one blast; the sentences do not. Stripping them is
 * what lets the same pitch sent to forty clients hash to one value.
 */
export function fingerprint(lead) {
  const body = bodyOf(lead)
    .replace(URL_RE, ' ')
    .replace(/[\w.+-]+@[\w.-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Too short to be distinctive: "how much" would otherwise match half the honest enquiries.
  if (body.length < 40) return '';
  let h = 0n; const P = 1099511628211n, M = (1n << 64n) - 1n;
  for (const ch of body) { h = ((h ^ BigInt(ch.charCodeAt(0))) * P) & M; }
  return h.toString(36).slice(0, 14);
}
