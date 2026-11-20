/**
 * THE TWO NUMBERS A DEAL HAS TO LIVE BETWEEN
 *
 * Both sides of a negotiation name a price, and both need a floor and a ceiling —
 * otherwise "negotiate" becomes a way to waste a whole city's riders on an offer
 * nobody could ever take, and "ask for more" becomes a way to send a customer a
 * number that looks like a threat rather than a quote.
 *
 * Kept as plain functions with no database and no Nest, so the rules can be read
 * (and tested) without wiring up a server.
 */
import { formatNaira } from '@dispatch/shared';

/**
 * Rounded down to ₦50 — and a naira is 100 kobo, so that is 5,000 kobo. Getting
 * this wrong by a factor of 100 would floor every offer to the nearest 50 kobo and
 * quietly make the floor meaningless, which is exactly what the test caught.
 */
const roundToFiftyNaira = (kobo: bigint): bigint => (kobo / 5_000n) * 5_000n;

/**
 * The lowest offer a customer may make for a route: half the bill.
 *
 * Below half, a rider is working for fuel money, and letting the offer through
 * only means watching it be refused by everyone in the city — the customer waits,
 * then books again at a higher price. Better to say no at the start.
 */
export function lowestAsk(quotedKobo: bigint): bigint {
  return roundToFiftyNaira(quotedKobo / 2n);
}

/** The highest offer a customer may make: three times the bill (a generous tip). */
export function highestAsk(quotedKobo: bigint): bigint {
  return quotedKobo * 3n;
}

export type BandCheck = { ok: true } | { ok: false; message: string };

/**
 * Is this a real negotiation, or a typo?
 *
 * Note what it accepts: a customer offering MORE than the bill. That is not a
 * mistake — it is how you get a rider to a hard address at 9pm — so it is allowed
 * all the way to the ceiling.
 */
export function checkAsk(quotedKobo: bigint, askKobo: bigint): BandCheck {
  const floor = lowestAsk(quotedKobo);
  const ceiling = highestAsk(quotedKobo);
  if (askKobo < floor) {
    return {
      ok: false,
      message: `The lowest offer accepted for this route is ${formatNaira(floor)}. Accept the bill, or offer between ${formatNaira(floor)} and ${formatNaira(ceiling)}.`,
    };
  }
  if (askKobo > ceiling) {
    return {
      ok: false,
      message: `That is more than three times the bill. Offer at most ${formatNaira(ceiling)}.`,
    };
  }
  return { ok: true };
}

/**
 * A rider asking for more than the customer's number.
 *
 * At or below the asking price there is nothing to negotiate: they should take the
 * job, and the message says so. Above three times the ask, a slipped key is far
 * more likely than a genuine demand.
 */
export function checkCounter(askKobo: bigint, counterKobo: bigint): BandCheck {
  if (counterKobo <= askKobo) {
    return {
      ok: false,
      message: `Ask for more than ${formatNaira(askKobo)}, or accept the job at ${formatNaira(askKobo)}.`,
    };
  }
  const ceiling = askKobo * 3n;
  if (counterKobo > ceiling) {
    return {
      ok: false,
      message: `That is more than three times the asking price. Ask for at most ${formatNaira(ceiling)}.`,
    };
  }
  return { ok: true };
}
