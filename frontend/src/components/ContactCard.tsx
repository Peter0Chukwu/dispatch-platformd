import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardBody, CardHeader, Input, useToast } from './ui';
import { LIVE_EVENTS, useLiveEvent } from '../lib/live';
import { useApiError } from '../contexts/AuthContext';
import { useContactStatus, useMessages, useRequestCall, useSendMessage } from '../hooks/useChat';

/**
 * CONTACT — the customer and the rider reaching each other without either one
 * learning the other's phone number.
 *
 * Two routes, one card:
 *   · Message — always available, free, instant, and it keeps a record.
 *   · Call — dials a proxy number issued by a voice provider. Until that provider
 *     is connected the card says so plainly instead of showing a button that
 *     dials silence.
 *
 * The server is the only authority on all three rules (who may talk, while the
 * delivery is live, and no phone numbers in the text). This component only
 * reflects its answers.
 */
export function ContactCard({
  deliveryId,
  perspective,
  counterpartName,
  enabled = true,
}: {
  deliveryId: string;
  perspective: 'CUSTOMER' | 'RIDER';
  counterpartName?: string;
  enabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const messages = useMessages(deliveryId, { enabled });
  const contact = useContactStatus(deliveryId, { enabled });
  const send = useSendMessage(deliveryId);
  const call = useRequestCall(deliveryId);
  const sendError = useApiError(send.error);
  const callError = useApiError(call.error);

  // A message that arrives while the panel is open refetches the thread.
  useLiveEvent(LIVE_EVENTS.MESSAGE_NEW, () => {
    void queryClient.invalidateQueries({ queryKey: ['chat', deliveryId] });
  });

  const rows = messages.data?.messages ?? [];

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [rows.length]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      await send.mutateAsync(body);
      setDraft('');
    } catch {
      setError(sendError ?? 'The message could not be sent. Try again.');
    }
  };

  const placeCall = async () => {
    setError(null);
    try {
      const result = await call.mutateAsync();
      notify({
        tone: 'success',
        title: 'Dial this number',
        description: `${result.proxyNumber} connects you to ${counterpartName ?? 'them'} — no real numbers are shared.`,
      });
    } catch {
      setError(callError ?? 'Calling is not available right now.');
    }
  };

  return (
    <Card>
      <CardHeader
        title="Contact"
        subtitle={
          counterpartName
            ? `Talk to ${counterpartName} without sharing phone numbers`
            : 'Talk to each other without sharing phone numbers'
        }
        action={
          contact.data?.connected ? (
            <Badge tone="success">calling ready</Badge>
          ) : (
            <Badge tone="neutral">messaging only</Badge>
          )
        }
      />
      <CardBody className="space-y-3">
        <div ref={listRef} className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-ink-50 p-3">
          {messages.isLoading && <p className="text-xs text-ink-500">Loading messages…</p>}
          {!messages.isLoading && rows.length === 0 && (
            <p className="text-xs text-ink-500">
              No messages yet. Anything you say here stays with this delivery.
            </p>
          )}
          {rows.map((row) => {
            const mine = row.senderType === perspective;
            return (
              <div key={row.id} className={mine ? 'text-right' : 'text-left'}>
                <span
                  className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? 'bg-brand-900 text-white' : 'bg-white text-ink-800 shadow-card'
                  }`}
                >
                  {row.body}
                </span>
                <p className="mt-1 text-[10px] text-ink-400">
                  {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            );
          })}
        </div>

        {enabled ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message…"
                maxLength={1000}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
              />
            </div>
            <Button onClick={() => void submit()} isLoading={send.isPending} disabled={!draft.trim()}>
              Send
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-500">
            This delivery has ended, so the conversation is closed. The history stays readable.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <p className="text-xs text-ink-500">
            {contact.data?.connected
              ? 'Calls are bridged through a proxy number — neither side sees a real one.'
              : 'Calling is not connected yet. Messaging works right now and costs nothing.'}
          </p>
          <Button
            variant="secondary"
            onClick={() => void placeCall()}
            isLoading={call.isPending}
            disabled={!contact.data?.connected}
          >
            Call
          </Button>
        </div>

        {error && <p className="text-xs text-danger-600">{error}</p>}
      </CardBody>
    </Card>
  );
}
