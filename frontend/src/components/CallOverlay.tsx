import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import {
  acceptCall,
  declineCall,
  dismissCall,
  endCall,
  remoteStream,
  subscribeToCall,
  toggleMute,
  type CallSnapshot,
} from '../lib/call';

/**
 * The call itself, drawn over whatever screen the person was on.
 *
 * It renders nothing at all until a call exists, so it can be mounted once at the
 * top of the app and forgotten. Every decision about who may call whom happens on
 * the server; this component only shows the state and offers the two buttons a
 * person expects: answer or decline, mute or hang up.
 */
export function CallOverlay() {
  const [call, setCall] = useState<CallSnapshot>({ phase: 'idle', muted: false, seconds: 0 });
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => subscribeToCall(setCall), []);

  // The other person's voice. Attached on every snapshot because the underlying
  // stream object is replaced when the connection is established.
  useEffect(() => {
    const stream = remoteStream();
    const element = audioRef.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [call.phase, call.callId]);

  if (call.phase === 'idle') return null;

  const label = call.peerLabel ?? 'the other person';
  const titles: Record<string, string> = {
    dialling: `Calling ${label}…`,
    ringing: `${label} is calling`,
    connecting: 'Connecting…',
    active: `On a call with ${label}`,
    ended: 'Call ended',
  };

  const timer = `${String(Math.floor(call.seconds / 60)).padStart(2, '0')}:${String(call.seconds % 60).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-sm rounded-2xl border border-ink-200 bg-white p-4 shadow-xl sm:inset-x-auto sm:right-6"
      role="dialog"
      aria-label="Call"
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <p className="text-sm font-semibold text-ink-900">{titles[call.phase]}</p>
      {call.phase === 'active' && <p className="mt-0.5 font-mono text-xs text-ink-500">{timer}</p>}
      {call.note && <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{call.note}</p>}
      {call.phase !== 'active' && call.phase !== 'ended' && (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          No phone numbers are shared — the call happens inside the app.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {call.phase === 'ringing' && (
          <>
            <Button variant="accent" onClick={() => void acceptCall()}>
              Answer
            </Button>
            <Button variant="secondary" onClick={declineCall}>
              Decline
            </Button>
          </>
        )}

        {(call.phase === 'dialling' || call.phase === 'connecting' || call.phase === 'active') && (
          <>
            <Button variant="secondary" onClick={() => toggleMute()}>
              {call.muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button variant="danger" onClick={endCall}>
              Hang up
            </Button>
          </>
        )}

        {call.phase === 'ended' && (
          <Button variant="secondary" onClick={dismissCall}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
