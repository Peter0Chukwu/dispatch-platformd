import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONE, formatNaira } from '@dispatch/shared';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  MoneyText,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  StatusPill,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '../components/ui';

type Row = { id: string; reference: string; customer: string; rider: string; status: keyof typeof DELIVERY_STATUS_LABELS; amountKobo: string };

const SAMPLE_ROWS: Row[] = [
  { id: '1', reference: 'DSP-261104-8F3K2A', customer: 'Adaeze Okafor', rider: 'Musa Ibrahim', status: 'IN_TRANSIT', amountKobo: '235000' },
  { id: '2', reference: 'DSP-261104-7B1M9Q', customer: 'Chinedu Eze', rider: 'Samuel Adeyemi', status: 'DELIVERED', amountKobo: '180000' },
  { id: '3', reference: 'DSP-261104-4X8P2L', customer: 'Fatima Bello', rider: '—', status: 'PENDING', amountKobo: '150000' },
];

const COLUMNS: Column<Row>[] = [
  { key: 'reference', header: 'Reference', render: (row) => <span className="font-mono text-xs font-medium text-ink-900">{row.reference}</span> },
  { key: 'customer', header: 'Customer', render: (row) => row.customer },
  { key: 'rider', header: 'Rider', render: (row) => row.rider, hideOnMobile: true },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusPill label={DELIVERY_STATUS_LABELS[row.status]} tone={DELIVERY_STATUS_TONE[row.status]} />,
  },
  { key: 'amount', header: 'Charge', align: 'right', render: (row) => <MoneyText kobo={row.amountKobo} size="sm" /> },
];

export default function StyleGuidePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<'overview' | 'riders' | 'finance'>('overview');
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const { notify } = useToast();

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">Phase 1 deliverable</p>
            <h1 className="mt-1 text-2xl font-bold text-ink-900">Design system</h1>
            <p className="mt-1 text-sm text-ink-500">
              Every component below is the real one used by all three portals — not a mock-up.
            </p>
          </div>
          <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
            ← Back to overview
          </Link>
        </div>

        {/* ── Colours ─────────────────────────────────────────────── */}
        <Section title="Colour palette">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { name: 'brand (navy)', cls: 'bg-brand-900', note: 'headers, primary buttons' },
              { name: 'accent (green)', cls: 'bg-accent-600', note: 'primary actions, success' },
              { name: 'danger', cls: 'bg-danger-600', note: 'destructive, failures' },
              { name: 'warning', cls: 'bg-warning-500', note: 'pending, attention' },
            ].map((swatch) => (
              <div key={swatch.name} className="overflow-hidden rounded-xl border border-ink-200 bg-white">
                <div className={`h-14 ${swatch.cls}`} />
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-ink-800">{swatch.name}</p>
                  <p className="text-[11px] text-ink-500">{swatch.note}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Buttons ─────────────────────────────────────────────── */}
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="accent">Book delivery</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Cancel delivery</Button>
            <Button variant="link">Link style</Button>
            <Button isLoading>Processing</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large (44px touch)</Button>
          </div>
        </Section>

        {/* ── Stat cards ──────────────────────────────────────────── */}
        <Section title="Dashboard statistic cards">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Deliveries today" value="0" hint="no bookings yet" />
            <StatCard label="Revenue this month" value={formatNaira(0n)} delta="—" deltaTone="neutral" />
            <StatCard label="Online riders" value="0" hint="of 0 approved" />
            <StatCard label="Loading state" value="" isLoading />
          </div>
        </Section>

        {/* ── Form controls ───────────────────────────────────────── */}
        <Section title="Form controls">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Recipient phone"
              placeholder="0803 123 4567"
              hint="Nigerian mobile number — validated by the same Zod schema as the API"
              required
            />
            <Input
              label="With validation error"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(event.target.value.includes('@') ? undefined : 'Enter a valid email address');
              }}
              error={error}
              placeholder="you@example.com"
            />
            <Select
              label="Package category"
              placeholder="Select a category"
              options={[
                { value: 'DOCUMENTS', label: 'Documents' },
                { value: 'ELECTRONICS', label: 'Electronics' },
                { value: 'FOOD', label: 'Food & drinks' },
              ]}
            />
            <Input label="Delivery charge (₦)" leftAddon="₦" placeholder="1,500.00" inputMode="decimal" />
            <Textarea
              label="Special instructions"
              placeholder="Call on arrival at the gate…"
              hint="Optional, up to 500 characters"
              className="sm:col-span-2"
            />
          </div>
        </Section>

        {/* ── Badges & status ─────────────────────────────────────── */}
        <Section title="Status pills (shared with the backend state machine)">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DELIVERY_STATUS_LABELS) as Array<keyof typeof DELIVERY_STATUS_LABELS>).map((status) => (
              <StatusPill key={status} label={DELIVERY_STATUS_LABELS[status]} tone={DELIVERY_STATUS_TONE[status]} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
        </Section>

        {/* ── Money & avatars ─────────────────────────────────────── */}
        <Section title="Money and identity">
          <div className="flex flex-wrap items-center gap-6">
            <MoneyText kobo="150000" size="xl" />
            <MoneyText kobo="150050" size="lg" />
            <MoneyText kobo="15005000" compact size="md" />
            <MoneyText kobo="-25000" signed />
            <MoneyText kobo="25000" signed />
            <MoneyText kobo={null} />
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Amounts are integers in kobo end-to-end (₦1,500.00 = 150000). The formatter is shared with the API, so
            rounding can never differ between server and browser.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Avatar name="Adaeze Okafor" />
            <Avatar name="Musa Ibrahim" size="lg" />
            <Avatar name="Support" size="sm" />
          </div>
        </Section>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <Section title="Tabs">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'riders', label: 'Riders', count: 0 },
              { value: 'finance', label: 'Finance' },
            ]}
          />
          <p className="mt-3 text-sm text-ink-600">Selected: <strong>{tab}</strong></p>
        </Section>

        {/* ── Table ───────────────────────────────────────────────── */}
        <Section title="Data table (with loading, empty and pagination states)">
          <DataTable columns={COLUMNS} rows={SAMPLE_ROWS} page={page} pageSize={2} total={6} onPageChange={setPage} />
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Loading state" subtitle="skeleton rows while data is in flight" />
              <div className="p-5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-3 h-4 w-2/3" />
              </div>
            </Card>
            <Card>
              <CardHeader title="Empty state" />
              <EmptyState title="No deliveries yet" description="Bookings will appear here the moment a customer confirms one." />
            </Card>
            <Card>
              <CardHeader title="Error state" />
              <ErrorState message="The connection dropped. Nothing was lost — try again." requestId="req_01HX8Z" onRetry={() => notify({ tone: 'info', title: 'Retrying…' })} />
            </Card>
            <Card>
              <CardHeader title="Spinners" />
              <div className="flex items-center gap-6 p-5 text-brand-900">
                <Spinner size="sm" />
                <Spinner />
                <Spinner size="lg" />
              </div>
            </Card>
          </div>
        </Section>

        {/* ── Alerts, toasts, dialogs ─────────────────────────────── */}
        <Section title="Feedback: alerts, toasts and dialogs">
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert tone="info" title="Rider assigned">Musa Ibrahim is on the way to the pickup point.</Alert>
            <Alert tone="success" title="Payment confirmed">Your payment of ₦1,500.00 was received.</Alert>
            <Alert tone="warning" title="Awaiting rider">We are finding the closest available rider.</Alert>
            <Alert tone="danger" title="Delivery failed">Nobody was available to receive the package.</Alert>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => notify({ tone: 'success', title: 'Saved', description: 'Your changes have been applied.' })}>
              Show success toast
            </Button>
            <Button variant="secondary" onClick={() => notify({ tone: 'error', title: 'Payment failed', description: 'The card was declined by the bank.' })}>
              Show error toast
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>Cancel delivery…</Button>
          </div>
        </Section>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Assign a rider"
          description="Choose an approved rider available in this service zone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button
                variant="accent"
                onClick={() => {
                  setModalOpen(false);
                  notify({ tone: 'success', title: 'Rider assigned' });
                }}
              >
                Assign rider
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Select label="Rider" options={[{ value: 'musa', label: 'Musa Ibrahim · 4.9★ · 1.2km away' }]} placeholder="Select a rider" />
            <Input label="Reason (optional)" placeholder="Closest available rider" />
          </div>
        </Modal>

        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            notify({ tone: 'warning', title: 'Delivery cancelled', description: 'The customer has been notified.' });
          }}
          title="Cancel this delivery?"
          message="The customer will be notified and any payment will be queued for refund. This cannot be undone."
          confirmLabel="Yes, cancel delivery"
        />

        <footer className="mt-12 border-t border-ink-200 pt-6 text-xs text-ink-500">
          Fonts are system-provided and no external CDN is used, so the app renders instantly on slow mobile networks
          and inside sandboxed previews.
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{title}</h2>
      <div className="card-surface p-5">{children}</div>
    </section>
  );
}
