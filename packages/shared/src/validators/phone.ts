/**
 * Nigerian phone number handling.
 *
 * Accepts everything a real customer types — "0803 123 4567", "+2348031234567",
 * "2348031234567", "08031234567" — and normalises to E.164 (+2348031234567).
 * We store ONLY the E.164 form so that OTP lookup, SMS delivery and duplicate
 * detection always agree.
 *
 * Valid Nigerian mobile prefixes: 070, 080, 081, 090, 091, 0708/0818 (multi-SIM), etc.
 * Landlines (01-...) are intentionally rejected — riders and customers are mobile-first.
 */

const NG_MOBILE_E164 = /^\+234(70|71|80|81|90|91)\d{8}$/;

export function normaliseNgPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let national: string;

  if (digits.startsWith('+234')) national = digits.slice(4);
  else if (digits.startsWith('234')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  if (national.length !== 10) return null;
  const e164 = `+234${national}`;
  return NG_MOBILE_E164.test(e164) ? e164 : null;
}

export function isValidNgPhone(input: string): boolean {
  return normaliseNgPhone(input) !== null;
}

/** +2348031234567 => 0803 123 4567 (for display) */
export function formatNgPhone(e164: string): string {
  if (!e164.startsWith('+234') || e164.length !== 14) return e164;
  const n = e164.slice(4);
  return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

/** +2348031234567 => +234 *** *** 4567 (for logs, share links and screenshots) */
export function maskNgPhone(e164: string): string {
  if (e164.length < 8) return '***';
  return `${e164.slice(0, 4)} *** *** ${e164.slice(-4)}`;
}
