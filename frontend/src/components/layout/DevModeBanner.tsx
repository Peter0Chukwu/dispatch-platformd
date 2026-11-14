import { useHealth } from '../../hooks/useHealth';

/**
 * Shown whenever the backend reports a non-live integration mode.
 * A customer must never be unsure whether their card is really being charged,
 * so the banner stays — but it speaks to the customer, not to the developer.
 */
export function DevModeBanner() {
  const { data } = useHealth();
  if (!data) return null;

  const simulated = [
    data.integrations.payments !== 'LIVE',
    data.integrations.sms !== 'TERMII',
    data.integrations.email !== 'RESEND',
  ].filter(Boolean).length;

  if (simulated === 0) return null;

  return (
    <div className="bg-warning-500/95 px-4 py-1.5 text-center text-[13px] font-medium text-warning-950">
      <span className="font-bold uppercase tracking-wide">Test mode</span>
      <span className="mx-1.5 opacity-60">·</span>
      no real money moves and no real messages are sent
    </div>
  );
}
