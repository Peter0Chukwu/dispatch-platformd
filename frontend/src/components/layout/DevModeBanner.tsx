import { useHealth } from '../../hooks/useHealth';

/**
 * Shown whenever the backend reports a non-live integration mode.
 * The owner (and every tester) must never be unsure whether money is real.
 */
export function DevModeBanner() {
  const { data } = useHealth();
  if (!data) return null;

  const simulated = [
    data.integrations.payments !== 'LIVE' && `payments (${data.integrations.payments})`,
    data.integrations.sms !== 'TERMII' && `SMS (${data.integrations.sms})`,
    data.integrations.email !== 'RESEND' && `email (${data.integrations.email})`,
    data.integrations.maps === 'STUB' && 'maps (stub)',
  ].filter(Boolean) as string[];

  if (simulated.length === 0) return null;

  return (
    <div className="bg-warning-500/95 px-4 py-1.5 text-center text-[13px] font-medium text-warning-950">
      <span className="font-bold uppercase tracking-wide">Development mode</span>
      <span className="mx-1.5 opacity-60">·</span>
      simulated: {simulated.join(', ')}
      <span className="mx-1.5 opacity-60">·</span>
      no real money or messages can move
    </div>
  );
}
