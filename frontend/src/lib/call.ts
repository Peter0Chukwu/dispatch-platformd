import { LIVE_EVENTS, emitLive, onLive } from './live';

/**
 * IN-APP CALLING (client side)
 *
 * A customer and a rider can talk about a live delivery without either of them
 * ever seeing the other's phone number — because no number is involved at all.
 * The audio goes straight from one browser to the other (WebRTC); the server only
 * introduces them and enforces who may ring whom, for how long.
 *
 * This file is the whole client half of that: the state machine the screens
 * render, and the peer connection behind it. It is deliberately outside React so
 * a call survives navigation between pages — a customer who opens their wallet
 * mid-call does not lose the call.
 *
 * Honest limits, stated here rather than discovered in a demo:
 *   · Both people must be signed in and online (the socket must be up).
 *   · Connection uses public STUN servers only. On a network that blocks direct
 *     peer-to-peer audio (some corporate and mobile-carrier NATs) the call cannot
 *     connect; the UI then says so and points at chat. A TURN relay fixes that and
 *     costs money per gigabyte — it is a deployment decision, not a code one.
 *   · Nothing is recorded, and nothing is stored on the server.
 */

export type CallPhase = 'idle' | 'dialling' | 'ringing' | 'connecting' | 'active' | 'ended';

export interface CallSnapshot {
  phase: CallPhase;
  callId?: string;
  /** Who is on the other end, for the label: "Customer" / "Rider" / their first name. */
  peerLabel?: string;
  deliveryId?: string;
  /** Why the call stopped, phrased for a person. */
  note?: string;
  muted: boolean;
  /** Seconds connected, for the timer. */
  seconds: number;
}

const IDLE: CallSnapshot = { phase: 'idle', muted: false, seconds: 0 };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

let snapshot: CallSnapshot = IDLE;
const listeners = new Set<(next: CallSnapshot) => void>();

let peer: RTCPeerConnection | null = null;
let media: MediaStream | null = null;
let localStream: MediaStream | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** Signals that arrive before the callee has picked up. */
let pendingOffer: RTCSessionDescriptionInit | null = null;

export function subscribeToCall(listener: (next: CallSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function currentCall(): CallSnapshot {
  return snapshot;
}

/** The other person's audio, for the <audio> element in the overlay. */
export function remoteStream(): MediaStream | null {
  return media;
}

function set(next: Partial<CallSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener(snapshot);
}

function reset(note?: string, keepVisible = false): void {
  stopTicker();
  pendingOffer = null;
  peer?.close();
  peer = null;
  for (const track of localStream?.getTracks() ?? []) track.stop();
  localStream = null;
  media = null;

  if (keepVisible && note) set({ ...IDLE, phase: 'ended', note });
  else set(IDLE);
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function startTicker(since: number): void {
  stopTicker();
  ticker = setInterval(() => {
    if (snapshot.phase !== 'active') return;
    set({ seconds: Math.max(0, Math.round((Date.now() - since) / 1000)) });
  }, 1000);
}

/* ─────────────────────────────── microphone ─────────────────────────────── */

async function openMicrophone(): Promise<boolean> {
  if (localStream) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    reset('This browser cannot make in-app calls. Use the message box instead.', true);
    return false;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return true;
  } catch {
    // Denied permission, or no microphone. Say which, without being dramatic.
    reset(
      'We could not use your microphone. Allow microphone access in the browser, or message instead — the thread works without it.',
      true,
    );
    return false;
  }
}

/* ─────────────────────────────── the call ─────────────────────────────── */

/** Call the other person on this delivery. */
export async function startCall(deliveryId: string): Promise<void> {
  if (snapshot.phase !== 'idle' && snapshot.phase !== 'ended') return;

  set({ ...IDLE, phase: 'dialling', deliveryId, note: undefined });
  if (!(await openMicrophone())) return;

  const sent = emitLive('call:start', { deliveryId }, (reply) => {
    const answer = reply as { ok?: boolean; callId?: string; error?: string; message?: string };
    if (!answer?.ok || !answer.callId) {
      reset(answer?.message ?? 'The call could not be placed.', true);
      return;
    }
    set({ phase: 'ringing', callId: answer.callId });
  });

  if (!sent) reset('You are offline. Check your connection and try again.', true);
}

/** Accept the incoming call. */
export async function acceptCall(): Promise<void> {
  if (snapshot.phase !== 'ringing' || !snapshot.callId) return;
  const callId = snapshot.callId;

  set({ phase: 'connecting' });
  if (!(await openMicrophone())) return;

  emitLive('call:accept', { callId });
  // Any offer that arrived while it was ringing is applied now.
  if (pendingOffer) {
    await applyOffer(pendingOffer);
    pendingOffer = null;
  }
}

/** Decline the incoming call. */
export function declineCall(): void {
  const callId = snapshot.callId;
  if (callId) emitLive('call:end', { callId, reason: 'DECLINED' });
  reset('Call declined.');
}

/** Hang up — from either side, at any point. */
export function endCall(): void {
  const callId = snapshot.callId;
  if (callId) emitLive('call:end', { callId, reason: 'HUNG_UP' });
  reset();
}

export function toggleMute(): boolean {
  const next = !snapshot.muted;
  for (const track of localStream?.getAudioTracks() ?? []) track.enabled = !next;
  set({ muted: next });
  return next;
}

export function dismissCall(): void {
  if (snapshot.phase === 'ended') reset();
}

/* ─────────────────────────────── peer wiring ─────────────────────────────── */

function ensurePeer(callId: string): RTCPeerConnection {
  if (peer) return peer;

  const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer = connection;

  for (const track of localStream?.getTracks() ?? []) connection.addTrack(track, localStream!);

  connection.onicecandidate = (event) => {
    if (event.candidate) emitLive('call:signal', { callId, data: { kind: 'ice', candidate: event.candidate } });
  };

  media = new MediaStream();
  connection.ontrack = (event) => {
    media = event.streams[0] ?? media;
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;
    if (state === 'connected') {
      set({ phase: 'active', seconds: 0 });
      startTicker(Date.now());
    }
    if (state === 'failed') {
      reset('The call could not connect — your network may block direct audio. Try the message box.', true);
    }
    if (state === 'disconnected') {
      // Give it a moment: mobile networks drop and come straight back. If it stays
      // down, the call is over and the UI must not pretend otherwise.
      setTimeout(() => {
        if (peer?.connectionState === 'disconnected') {
          reset('The call dropped. You can call again while the delivery is live.', true);
        }
      }, 8000);
    }
  };

  return connection;
}

async function applyOffer(offer: RTCSessionDescriptionInit): Promise<void> {
  const callId = snapshot.callId;
  if (!callId) return;
  const connection = ensurePeer(callId);
  await connection.setRemoteDescription(offer);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  emitLive('call:signal', { callId, data: { kind: 'answer', sdp: answer } });
}

/* ─────────────────────────── incoming events ─────────────────────────── */

onLive(LIVE_EVENTS.CALL_INCOMING, (payload) => {
  const push = payload as { callId: string; deliveryId: string; from: 'CUSTOMER' | 'RIDER'; fromName?: string };
  if (snapshot.phase !== 'idle' && snapshot.phase !== 'ended') {
    // Already busy: tell the caller rather than leaving them ringing at a wall.
    emitLive('call:end', { callId: push.callId, reason: 'DECLINED' });
    return;
  }
  set({
    ...IDLE,
    phase: 'ringing',
    callId: push.callId,
    deliveryId: push.deliveryId,
    peerLabel: push.fromName ?? (push.from === 'CUSTOMER' ? 'Customer' : 'Rider'),
    note: undefined,
  });
});

onLive(LIVE_EVENTS.CALL_ACCEPTED, (payload) => {
  const { callId } = payload as { callId: string };
  if (snapshot.callId !== callId) return;

  set({ phase: 'connecting' });
  const connection = ensurePeer(callId);
  // The caller offers once it knows the other side picked up.
  void (async () => {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    emitLive('call:signal', { callId, data: { kind: 'offer', sdp: offer } });
  })();
});

onLive(LIVE_EVENTS.CALL_SIGNAL, (payload) => {
  const { callId, data } = payload as {
    callId: string;
    data: { kind: 'offer' | 'answer' | 'ice'; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  };
  if (snapshot.callId !== callId || !data) return;

  if (data.kind === 'offer') {
    // Callee: hold the offer until they actually pick up.
    if (snapshot.phase === 'ringing') pendingOffer = data.sdp ?? null;
    else void applyOffer(data.sdp!);
    return;
  }

  const connection = peer;
  if (!connection) return;
  if (data.kind === 'answer' && data.sdp) void connection.setRemoteDescription(data.sdp);
  if (data.kind === 'ice' && data.candidate) void connection.addIceCandidate(data.candidate).catch(() => undefined);
});

for (const event of [LIVE_EVENTS.CALL_DECLINED, LIVE_EVENTS.CALL_ENDED]) {
  onLive(event, (payload) => {
    const { callId, reason } = payload as { callId: string; reason?: string };
    if (snapshot.callId !== callId) return;
    reset(reason === 'MISSED' ? 'No answer.' : 'The call ended.');
  });
}

onLive(LIVE_EVENTS.CALL_ERROR, (payload) => {
  const { message } = payload as { message?: string };
  reset(message ?? 'The call could not be placed.', true);
});

/** A dropped socket means no call — stop pretending otherwise. */
export function handleLiveDropped(): void {
  if (snapshot.phase !== 'idle') reset('The connection dropped, so the call ended.', true);
}

// live.ts avoids importing this file (that would be a cycle), so it announces the
// drop on the window and the call state listens for it.
window.addEventListener('live:dropped', handleLiveDropped);
