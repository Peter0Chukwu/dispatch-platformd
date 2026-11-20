import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, useToast } from './ui';
import { api } from '../lib/api';
import { useApiError } from '../contexts/AuthContext';

interface MessagingStatus {
  sms: { mode: string; ready: boolean; senderId: string; route: string; problem: string | null };
  email: { mode: string; ready: boolean; from: string; problem: string | null };
}

interface TestResult {
  delivered: boolean;
  driver: string;
  reason?: string;
  providerMessage?: string;
  to: string;
}

/**
 * IS MESSAGING WORKING?
 *
 * One button, two channels, and the provider's own answer printed on the screen.
 *
 * Without this, the only way to find out whether a customer's verification code left
 * the building is to register an account and wait — which is how a missing API key
 * survives for weeks. The panel states the configuration too, because the usual cause
 * is not the code: it is a key that was never pasted into the host, a sender ID the
 * provider has not approved, or the wrong route for a do-not-disturb number.
 */
export function MessagingTestPanel() {
  const { notify } = useToast();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);

  const status = useQuery({
    queryKey: ['admin', 'messaging', 'status'],
    queryFn: () => api.get<MessagingStatus>('/admin/messaging/status'),
  });

  const send = useMutation({
    mutationFn: (input: { channel: 'SMS' | 'EMAIL'; to: string }) =>
      api.post<TestResult>('/admin/messaging/test', input),
    onSuccess: (data) => {
      setResult(data);
      notify({
        tone: data.delivered ? 'success' : 'error',
        title: data.delivered ? 'The provider accepted it' : 'Nothing was delivered',
        description: data.delivered
          ? `Handed to ${data.driver}. Check the phone or inbox.`
          : (data.providerMessage ?? data.reason ?? 'See the panel for the reason.'),
      });
    },
  });

  const error = useApiError(send.error);
  const sms = status.data?.sms;
  const mail = status.data?.email;

  return (
    <Card>
      <CardHeader
        title="Messaging"
        subtitle="Whether codes and emails actually leave this server, and a way to prove it."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-900">SMS</p>
              <Badge tone={sms?.ready ? 'success' : 'warning'}>{sms?.ready ? 'live' : 'not sending'}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              {sms ? `${sms.mode} · route ${sms.route} · sender ${sms.senderId || 'unset'}` : 'Checking…'}
            </p>
            {sms?.problem && <p className="mt-1.5 text-xs text-warning-800">{sms.problem}</p>}
          </div>
          <div className="rounded-xl border border-ink-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-900">Email</p>
              <Badge tone={mail?.ready ? 'success' : 'warning'}>{mail?.ready ? 'live' : 'not sending'}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-ink-500" title={mail?.from ?? ''}>
              {mail ? `${mail.mode} · ${mail.from}` : 'Checking…'}
            </p>
            {mail?.problem && <p className="mt-1.5 text-xs text-warning-800">{mail.problem}</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label="Send a test SMS to" htmlFor="test-phone" hint="Your own phone. Costs one message when live.">
              <Input
                id="test-phone"
                inputMode="tel"
                placeholder="0803 123 4567"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            <Button
              className="w-full"
              isLoading={send.isPending && send.variables?.channel === 'SMS'}
              disabled={phone.trim().length < 6}
              onClick={() => send.mutate({ channel: 'SMS', to: phone.trim() })}
            >
              Send test SMS
            </Button>
          </div>
          <div className="space-y-2">
            <Field label="Send a test email to" htmlFor="test-email" hint="Your own inbox.">
              <Input
                id="test-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              isLoading={send.isPending && send.variables?.channel === 'EMAIL'}
              disabled={email.trim().length < 5}
              onClick={() => send.mutate({ channel: 'EMAIL', to: email.trim() })}
            >
              Send test email
            </Button>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-danger-700">{error}</p>}

        {result && (
          <div
            className={
              result.delivered
                ? 'rounded-xl border border-success-200 bg-success-50 p-3 text-xs text-ink-700'
                : 'rounded-xl border border-warning-200 bg-warning-50 p-3 text-xs text-ink-700'
            }
          >
            <p className="font-semibold text-ink-900">
              {result.delivered ? 'Accepted by the provider' : 'Not delivered'}
              <span className="ml-1 font-normal text-ink-500">via {result.driver}</span>
            </p>
            {(result.providerMessage || result.reason) && (
              <p className="mt-1 font-mono text-[11px] leading-relaxed">{result.providerMessage ?? result.reason}</p>
            )}
            <p className="mt-1.5 text-ink-500">
              {result.delivered
                ? 'Accepted means the provider took it — not that a handset buzzed. Give it a minute.'
                : 'Nothing left this server. The message above is the provider\'s own words.'}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
