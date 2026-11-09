import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CHAT_OPEN_STATUSES } from '@dispatch/shared';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Spinner,
  StatusPill,
  Textarea,
  useToast,
} from '../../components/ui';
import { RIDER_NAV } from './nav';
import { DeliveryPhoto } from '../../components/DeliveryPhoto';
import { ContactCard } from '../../components/ContactCard';
import { LocationReporter } from '../../components/LocationReporter';
import { LIVE_EVENTS, useLiveEvent } from '../../lib/live';
import { useApiError } from '../../contexts/AuthContext';
import {
  useActiveJob,
  useAdvanceJob,
  useCompleteJob,
  useFailJob,
  useJob,
  type JobStep,
  type RiderJob,
} from '../../hooks/useRider';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

/** The order the server enforces, mirrored so the rider sees a progress bar. */
const WORKFLOW = [
  { status: 'ACCEPTED', label: 'Accepted', step: null },
  { status: 'ARRIVED_AT_PICKUP', label: 'At pickup', step: 'arrive-pickup' as JobStep },
  { status: 'PICKED_UP', label: 'Collected', step: 'pickup' as JobStep },
  { status: 'IN_TRANSIT', label: 'In transit', step: 'start-transit' as JobStep },
  { status: 'ARRIVED_AT_DESTINATION', label: 'At destination', step: 'arrive-destination' as JobStep },
  { status: 'DELIVERED', label: 'Delivered', step: null },
];

const NEXT_ACTION: Record<string, { step: JobStep; label: string; hint: string } | undefined> = {
  ACCEPTED: { step: 'arrive-pickup', label: 'I have arrived at the pickup', hint: 'Let the sender know you are here.' },
  ASSIGNED: { step: 'arrive-pickup', label: 'I have arrived at the pickup', hint: 'Let the sender know you are here.' },
  ARRIVED_AT_PICKUP: { step: 'pickup', label: 'Package collected', hint: 'Only tap once you physically have the package.' },
  PICKED_UP: { step: 'start-transit', label: 'Start the trip', hint: 'The customer can now follow you.' },
  IN_TRANSIT: { step: 'arrive-destination', label: 'I have arrived at the destination', hint: 'Then prove delivery with the code or a photo.' },
  ARRIVED_AT_DESTINATION: undefined,
};

export default function ActiveJobPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();
  const requestedId = params.get('job') ?? undefined;
  const queryClient = useQueryClient();

  // The office can cancel or reassign a job under the rider's feet; the screen must
  // follow the server instead of insisting on a status that no longer exists.
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_UPDATED,
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['rider', 'active-job'] });
      void queryClient.invalidateQueries({ queryKey: ['rider', 'profile'] });
    }, [queryClient]),
  );

  const active = useActiveJob();
  const id = requestedId ?? active.data?.id;
  const job = useJob(id);

  const data: RiderJob | null | undefined = job.data ?? active.data ?? null;

  const advance = useAdvanceJob(id ?? '');
  const complete = useCompleteJob(id ?? '');
  const fail = useFailJob(id ?? '');

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [mode, setMode] = useState<'otp' | 'photo'>('otp');
  const [otp, setOtp] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [photo, setPhoto] = useState<{ key: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);

  const progress = useMemo(() => {
    const index = WORKFLOW.findIndex((entry) => entry.status === data?.status);
    return index === -1 ? 0 : index;
  }, [data?.status]);

  const next = data ? NEXT_ACTION[data.status] : undefined;
  const canProve = data?.status === 'ARRIVED_AT_DESTINATION';

  if (active.isLoading && job.isLoading) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    );
  }

  if ((job.isError || active.isError) && !data) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <ErrorState title="We could not load your job" onRetry={() => void job.refetch()} />
      </PortalShell>
    );
  }

  if (!data) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardBody>
              <EmptyState
                title="No active job"
                description="Accept an offer to start delivering. Your current job appears here with each step to complete."
                action={{ label: 'View offers', onClick: () => navigate('/rider/offers') }}
              />
            </CardBody>
          </Card>
        </div>
      </PortalShell>
    );
  }

  const runStep = async () => {
    if (!next) return;
    setStepBusy(true);
    try {
      await advance.mutateAsync({ step: next.step });
      notify({ tone: 'success', title: 'Step recorded', description: 'Updated on the customer’s tracking view.' });
      void job.refetch();
    } catch (error) {
      notify({ tone: 'error', title: 'Could not update the job', description: useApiError(error) ?? 'Please try again.' });
    } finally {
      setStepBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result = await api.post<{ proofPhotoKey: string }>(`/rider/jobs/${data.id}/proof-photo`, {
        mimeType: file.type,
        base64,
      });
      setPhoto({ key: result.proofPhotoKey, name: file.name });
      notify({ tone: 'success', title: 'Photo attached', description: 'Add the recipient’s name, then confirm delivery.' });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not upload the photo', description: useApiError(error) ?? 'Try a smaller image.' });
    } finally {
      setUploading(false);
    }
  };

  const confirmDelivery = async () => {
    try {
      const payload =
        mode === 'otp'
          ? { otp }
          : { proofPhotoKey: photo?.key, recipientNameEntered: recipientName };
      const result = await complete.mutateAsync(payload);
      notify({
        tone: 'success',
        title: 'Delivery completed',
        description: result.earning ? `You earned ${result.pay.netFormatted}.` : 'The customer has been notified.',
      });
      setDeliverOpen(false);
      navigate('/rider/earnings');
    } catch (error) {
      notify({ tone: 'error', title: 'Could not complete the delivery', description: useApiError(error) ?? 'Check the code and try again.' });
    }
  };

  const confirmFail = async () => {
    try {
      await fail.mutateAsync(failReason);
      notify({ tone: 'info', title: 'Job reported', description: 'Our dispatch team will take it from here.' });
      setFailOpen(false);
      navigate('/rider');
    } catch (error) {
      notify({ tone: 'error', title: 'Could not report the job', description: useApiError(error) ?? 'Please try again.' });
    }
  };

  return (
    <PortalShell portal="Rider" nav={RIDER_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">{data.reference}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {data.deliveryType.replace(/_/g, ' ').toLowerCase()} ·{' '}
              {data.distanceKm?.toFixed(1) ?? '—'} km · {data.package.category.toLowerCase()}
            </p>
          </div>
          <div className="text-right">
            <StatusPill label={data.statusLabel} tone="info" />
            <p className="mt-1 text-sm font-bold text-accent-700">{data.pay.netFormatted}</p>
          </div>
        </div>

        {/* The customer is watching this job's map: report position while it is open. */}
        <LocationReporter deliveryId={data.id} />

        {/* Progress rail */}
        <Card>
          <CardBody>
            <ol className="flex items-center justify-between gap-1">
              {WORKFLOW.map((entry, index) => {
                const done = index < progress;
                const current = index === progress;
                return (
                  <li key={entry.status} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold',
                        done && 'bg-accent-600 text-white',
                        current && 'bg-brand-900 text-white ring-4 ring-brand-100',
                        !done && !current && 'bg-ink-100 text-ink-400',
                      )}
                      aria-current={current ? 'step' : undefined}
                    >
                      {done ? '✓' : index + 1}
                    </span>
                    <span className={cn('text-[10px] font-medium leading-tight', current ? 'text-ink-900' : 'text-ink-500')}>
                      {entry.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Route" subtitle={`Recipient: ${data.recipientName}`} />
          <CardBody className="space-y-3 text-sm">
            <div className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent-500" aria-hidden />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Pick up</p>
                <p className="text-ink-800">{data.pickup.address}</p>
                {data.pickup.landmark && <p className="text-xs text-ink-500">{data.pickup.landmark}</p>}
              </div>
            </div>
            <div className="ml-[4px] h-4 w-px bg-ink-200" aria-hidden />
            <div className="flex gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-900" aria-hidden />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Deliver to</p>
                <p className="text-ink-800">{data.destination.address}</p>
                {data.destination.landmark && <p className="text-xs text-ink-500">{data.destination.landmark}</p>}
              </div>
            </div>
            {data.package.specialInstructions && (
              <Alert tone="info" title="Instructions from the sender">
                {data.package.specialInstructions}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge tone="neutral">{data.package.weightKg ? `${data.package.weightKg} kg` : 'weight not stated'}</Badge>
              {data.package.isFragile && <Badge tone="warning">fragile — handle with care</Badge>}
            </div>
            <DeliveryPhoto deliveryId={data.id} className="h-44 w-full rounded-xl object-cover" />
          </CardBody>
        </Card>

        <ContactCard
          deliveryId={data.id}
          perspective="RIDER"
          enabled={(CHAT_OPEN_STATUSES as readonly string[]).includes(data.status)}
        />

        {next && (
          <Card>
            <CardBody className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">Next step</p>
                <p className="text-xs text-ink-500">{next.hint}</p>
              </div>
              <Button fullWidth onClick={() => void runStep()} isLoading={stepBusy}>
                {next.label}
              </Button>
            </CardBody>
          </Card>
        )}

        {canProve && (
          <Card>
            <CardBody className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">Prove delivery</p>
                <p className="text-xs text-ink-500">
                  Ask the recipient for the 6-digit code from their tracking page, or photograph the handover.
                </p>
              </div>
              <Button fullWidth onClick={() => setDeliverOpen(true)}>
                Complete delivery
              </Button>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="History" subtitle="Every step is recorded with a timestamp" />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {(data.timeline ?? []).map((entry, index) => (
                <li key={`${entry.status}-${index}`} className="flex items-start justify-between gap-3">
                  <span className="text-ink-700">{entry.status.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {new Date(entry.at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="pb-4 text-center">
          <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setFailOpen(true)}>
            Something went wrong — report this job
          </Button>
        </div>
      </div>

      <Modal
        open={deliverOpen}
        onClose={() => setDeliverOpen(false)}
        title="Confirm delivery"
        description="The recipient confirms receipt with a code, or you can attach a photo of the handover."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmDelivery()}
              isLoading={complete.isPending}
              disabled={mode === 'otp' ? otp.length !== 6 : !photo || recipientName.trim().length < 2}
            >
              Confirm delivered
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === 'otp' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('otp')}>
              Recipient code
            </Button>
            <Button variant={mode === 'photo' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('photo')}>
              Photo proof
            </Button>
          </div>

          {mode === 'otp' ? (
            <Field label="6-digit code" hint="The recipient sees this on their delivery page.">
              <Input
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </Field>
          ) : (
            <div className="space-y-3">
              <Field label="Photo of the handover" hint="You can only attach a photo in transit or at the destination.">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadPhoto(file);
                  }}
                  className="block w-full rounded-xl border border-ink-300 p-2.5 text-sm"
                />
              </Field>
              {uploading && <p className="text-xs text-ink-500">Uploading…</p>}
              {photo && <p className="text-xs text-accent-700">Attached: {photo.name}</p>}
              <Field label="Recipient’s name" hint="The person who took the package.">
                <Input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="e.g. Chidi Okafor" />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={failOpen}
        onClose={() => setFailOpen(false)}
        title="Report a problem"
        description="This hands the job back to dispatch. Tell us what happened so they can act on it."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFailOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmFail()}
              isLoading={fail.isPending}
              disabled={failReason.trim().length < 5}
            >
              Report job
            </Button>
          </div>
        }
      >
        <Field label="What happened?" hint="At least 5 characters — dispatch reads this.">
          <Textarea
            value={failReason}
            onChange={(event) => setFailReason(event.target.value)}
            rows={3}
            placeholder="e.g. Recipient refused the package"
          />
        </Field>
      </Modal>
    </PortalShell>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
