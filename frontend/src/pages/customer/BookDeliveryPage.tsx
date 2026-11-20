import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PACKAGE_CATEGORIES, formatNaira } from '@dispatch/shared';
import { PortalShell } from '../../layouts/PortalShell';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea, useToast } from '../../components/ui';
import { PackagePhotoInput } from '../../components/PackagePhotoInput';
import { LocationPicker } from '../../components/LocationPicker';
import { PriceBreakdown } from '../../components/PriceBreakdown';
import { CUSTOMER_NAV } from './nav';
import { useCreateDelivery, useQuote, type Quote } from '../../hooks/useDeliveries';
import type { SavedLocation } from '../../lib/benin-city-locations';
import { cn } from '../../lib/cn';
import { useApiError } from '../../contexts/AuthContext';

const STEPS = ['From', 'To', 'Size', 'Bill'] as const;

/** ₦ formatting for the negotiation box, which is typed in naira and sent in kobo. */
const nairaOf = (kobo: bigint | number | string): number => Number(kobo) / 100;

const DELIVERY_TYPES = [
  { value: 'STANDARD', label: 'Standard', hint: 'Same city, within a few hours' },
  { value: 'EXPRESS', label: 'Express', hint: 'Priority rider, fastest slot' },
  { value: 'SAME_DAY', label: 'Same day', hint: 'Guaranteed before midnight' },
  { value: 'SCHEDULED', label: 'Scheduled', hint: 'Choose a date and time' },
] as const;

interface PlaceState {
  locationId: string | null;
  address: string;
  landmark: string;
  contactName: string;
  contactPhone: string;
  lat: number | null;
  lng: number | null;
}

const emptyPlace = (): PlaceState => ({
  locationId: null,
  address: '',
  landmark: '',
  contactName: '',
  contactPhone: '',
  lat: null,
  lng: null,
});

export default function BookDeliveryPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const createDelivery = useCreateDelivery();

  const [step, setStep] = useState(0);
  const [pickup, setPickup] = useState<PlaceState>(emptyPlace);
  const [destination, setDestination] = useState<PlaceState>(emptyPlace);
  const [deliveryType, setDeliveryType] = useState<string>('STANDARD');
  const [scheduledFor, setScheduledFor] = useState('');
  const [packageCategory, setPackageCategory] = useState('DOCUMENTS');
  const [packageDescription, setPackageDescription] = useState('');
  const [packagePhotoKey, setPackagePhotoKey] = useState<string | undefined>(undefined);
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>(undefined);
  const [acceptTerms, setAcceptTerms] = useState(false);
  /**
   * What the customer decided about the bill: take it, or name their own price.
   * 'NONE' means they have not chosen yet — the bill step will not let them past
   * without answering, because riders cannot be asked for a number nobody picked.
   */
  const [decision, setDecision] = useState<'NONE' | 'ACCEPT' | 'NEGOTIATE'>('NONE');
  const [offerNaira, setOfferNaira] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const bothLocated = pickup.lat !== null && destination.lat !== null;

  // The server prices the trip; this call happens whenever the route changes.
  const quoteInput = useMemo(() => {
    if (!bothLocated) return null;
    return {
      deliveryType: deliveryType as 'STANDARD',
      pickup: { lat: pickup.lat!, lng: pickup.lng! },
      destination: { lat: destination.lat!, lng: destination.lng! },
      ...(deliveryType === 'SCHEDULED' && scheduledFor
        ? { scheduledFor: new Date(scheduledFor).toISOString() }
        : {}),
      ...(appliedPromo ? { promoCode: appliedPromo } : {}),
    };
  }, [bothLocated, pickup.lat, pickup.lng, destination.lat, destination.lng, deliveryType, scheduledFor, appliedPromo]);

  const { data: quote, isFetching: pricing, error: quoteError } = useQuote(quoteInput as never);

  const selectPlace = (setter: (value: PlaceState) => void) => (location: SavedLocation) => {
    setter({
      locationId: location.id,
      address: location.address,
      landmark: location.landmark,
      contactName: '',
      contactPhone: '',
      lat: location.lat,
      lng: location.lng,
    });
  };

  const validateStep = (index: number): boolean => {
    const errors: Record<string, string> = {};
    if (index === 0) {
      if (pickup.address.trim().length < 8) errors['pickup.address'] = 'Enter the full pickup address';
      if (!pickup.contactName.trim()) errors['pickup.contactName'] = 'Who should the rider meet?';
      if (!/^(\+?234|0)[789][01]\d{8}$/.test(pickup.contactPhone.replace(/[\s-]/g, ''))) {
        errors['pickup.contactPhone'] = 'Enter a valid Nigerian mobile number';
      }
    }
    if (index === 1) {
      if (destination.address.trim().length < 8) errors['destination.address'] = 'Enter the full drop-off address';
      if (!destination.contactName.trim()) errors['destination.contactName'] = 'Who is receiving the package?';
      if (!/^(\+?234|0)[789][01]\d{8}$/.test(destination.contactPhone.replace(/[\s-]/g, ''))) {
        errors['destination.contactPhone'] = 'Enter a valid Nigerian mobile number';
      }
    }
    if (index === 2) {
      // A description and a photo are both optional now: the size is what prices
      // the job, and asking for more than that is how a one-minute booking becomes
      // a form people abandon.
      if (deliveryType === 'SCHEDULED' && !scheduledFor) {
        errors['scheduledFor'] = 'Choose when it should be collected';
      }
    }
    if (index === 3) {
      if (decision === 'NONE') {
        errors['decision'] = 'Accept the bill, or tell us what you want to pay';
      }
      if (decision === 'NEGOTIATE') {
        const offered = Number(offerNaira.replace(/,/g, ''));
        if (!Number.isFinite(offered) || offered <= 0) {
          errors['askKobo'] = 'Enter the amount you want to pay';
        }
      }
      if (!acceptTerms) {
        errors['acceptTerms'] = 'Tick the box to accept the delivery terms';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  };

  const submit = async () => {
    if (!quote) return;
    const payload = {
      deliveryType: deliveryType as 'STANDARD',
      pickup: {
        address: pickup.address,
        landmark: pickup.landmark || undefined,
        lat: pickup.lat!,
        lng: pickup.lng!,
        contactName: pickup.contactName,
        contactPhone: pickup.contactPhone,
      },
      destination: {
        address: destination.address,
        landmark: destination.landmark || undefined,
        lat: destination.lat!,
        lng: destination.lng!,
        contactName: destination.contactName,
        contactPhone: destination.contactPhone,
      },
      packageCategory,
      packageDescription,
      ...(packagePhotoKey ? { packagePhotoKey } : {}),
      ...(deliveryType === 'SCHEDULED' && scheduledFor ? { scheduledFor: new Date(scheduledFor) } : {}),
      ...(appliedPromo ? { promoCode: appliedPromo } : {}),
      acceptTerms: true as const,
      paymentMethod: 'PAYSTACK' as const,
      // The bill was on screen; this is the answer to it.
      pricingDecision: decision === 'NEGOTIATE' ? ('NEGOTIATE' as const) : ('ACCEPT' as const),
      ...(decision === 'NEGOTIATE'
        ? { askKobo: BigInt(Math.round(Number(offerNaira.replace(/,/g, '')) * 100)) }
        : {}),
    };

    try {
      const created = await createDelivery.mutateAsync(payload as never);
      notify({
        tone: 'success',
        title: decision === 'NEGOTIATE' ? 'Offer sent to riders' : 'Riders are being asked',
        description:
          decision === 'NEGOTIATE'
            ? `${created.reference} — you offered ${formatNaira(created.pricing?.askKobo ?? created.chargeKobo)}. Riders who accept, counter, and you decide.`
            : `${created.reference} — riders are being asked for ${created.chargeFormatted}. Pay once a rider accepts.`,
      });
      navigate(`/app/deliveries/${created.id}`);
    } catch (error) {
      notify({ tone: 'error', title: 'Could not create the booking', description: useApiError(error) ?? 'Please try again.' });
    }
  };

  const applyPromo = () => {
    setAppliedPromo(promoCode.trim().toUpperCase() || undefined);
  };

  return (
    <PortalShell portal="Customer" nav={CUSTOMER_NAV}>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Book a delivery</h1>
            <p className="mt-1 text-sm text-ink-500">
              Your fare is worked out from the distance between the two points and the area the pickup falls in.
            </p>
          </div>
          <Link to="/app/deliveries" className="text-sm font-medium text-brand-700 hover:underline">
            My deliveries →
          </Link>
        </div>

        {/* Progress */}
        <ol className="mt-6 flex flex-wrap gap-2">
          {STEPS.map((label, index) => (
            <li key={label} className="flex-1">
              <button
                type="button"
                onClick={() => index < step && setStep(index)}
                disabled={index > step}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors',
                  index === step && 'border-brand-500 bg-brand-50 text-brand-800',
                  index < step && 'border-ink-200 bg-white text-ink-600 hover:border-ink-300',
                  index > step && 'border-dashed border-ink-200 bg-white text-ink-300',
                )}
              >
                <span className="mr-1.5 opacity-60">{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardBody className="space-y-5">
              {step === 0 && (
                <LocationPicker
                  title="Where are we collecting from?"
                  selectedId={pickup.locationId}
                  onSelect={selectPlace(setPickup)}
                  address={pickup.address}
                  landmark={pickup.landmark}
                  onAddressChange={(address) => setPickup((current) => ({ ...current, address }))}
                  onLandmarkChange={(landmark) => setPickup((current) => ({ ...current, landmark }))}
                  contactName={pickup.contactName}
                  contactPhone={pickup.contactPhone}
                  onContactNameChange={(contactName) => setPickup((current) => ({ ...current, contactName }))}
                  onContactPhoneChange={(contactPhone) => setPickup((current) => ({ ...current, contactPhone }))}
                  errors={{
                    address: fieldErrors['pickup.address'],
                    contactName: fieldErrors['pickup.contactName'],
                    contactPhone: fieldErrors['pickup.contactPhone'],
                  }}
                />
              )}

              {step === 1 && (
                <LocationPicker
                  title="Where is it going?"
                  selectedId={destination.locationId}
                  onSelect={selectPlace(setDestination)}
                  address={destination.address}
                  landmark={destination.landmark}
                  onAddressChange={(address) => setDestination((current) => ({ ...current, address }))}
                  onLandmarkChange={(landmark) => setDestination((current) => ({ ...current, landmark }))}
                  contactName={destination.contactName}
                  contactPhone={destination.contactPhone}
                  onContactNameChange={(contactName) => setDestination((current) => ({ ...current, contactName }))}
                  onContactPhoneChange={(contactPhone) => setDestination((current) => ({ ...current, contactPhone }))}
                  errors={{
                    address: fieldErrors['destination.address'],
                    contactName: fieldErrors['destination.contactName'],
                    contactPhone: fieldErrors['destination.contactPhone'],
                  }}
                />
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-semibold text-ink-900">How big is it?</h3>
                    <p className="mt-0.5 text-xs text-ink-500">
                      This is what prices the trip along with the distance. Nothing else is required.
                    </p>
                  </div>

                  <Field label="Size of the parcel" required htmlFor="package-category">
                    <Select
                      id="package-category"
                      value={packageCategory}
                      options={PACKAGE_CATEGORIES.map((category) => ({
                        value: category.value,
                        label: category.label,
                      }))}
                      onChange={(event) => setPackageCategory(event.target.value)}
                    />
                  </Field>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {DELIVERY_TYPES.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDeliveryType(option.value)}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors',
                          deliveryType === option.value
                            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <p className="text-sm font-semibold text-ink-900">{option.label}</p>
                        <p className="text-xs text-ink-500">{option.hint}</p>
                      </button>
                    ))}
                  </div>

                  {deliveryType === 'SCHEDULED' && (
                    <Field
                      label="Collection date and time"
                      required
                      error={fieldErrors['scheduledFor']}
                      hint="At least 15 minutes from now"
                      htmlFor="scheduled-for"
                    >
                      <Input
                        id="scheduled-for"
                        type="datetime-local"
                        value={scheduledFor}
                        error={fieldErrors['scheduledFor']}
                        onChange={(event) => setScheduledFor(event.target.value)}
                      />
                    </Field>
                  )}

                  <Field
                    label="Photo of the parcel"
                    hint="Optional, but it protects you: the rider knows exactly what they are collecting, and the photo settles any damage dispute."
                  >
                    <PackagePhotoInput value={packagePhotoKey} onChange={setPackagePhotoKey} />
                  </Field>

                  <Field
                    label="What is inside?"
                    hint="Optional — a rider may open the package for a security check either way"
                    htmlFor="package-description"
                  >
                    <Textarea
                      id="package-description"
                      rows={2}
                      placeholder="e.g. A box of shoes"
                      value={packageDescription}
                      onChange={(event) => setPackageDescription(event.target.value)}
                    />
                  </Field>

                  <details className="rounded-xl border border-ink-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink-800">Have a promo code?</summary>
                    <div className="mt-3 flex gap-2">
                      <Input
                        placeholder="e.g. BENIN10"
                        value={promoCode}
                        onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                      />
                      <Button type="button" variant="secondary" onClick={applyPromo}>
                        Apply
                      </Button>
                    </div>
                    {appliedPromo && (
                      <p className="mt-1.5 text-xs text-ink-500">
                        Applied <strong>{appliedPromo}</strong>
                        {quote?.promo ? ` — ${quote.promo.description}` : ''}
                      </p>
                    )}
                  </details>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <h3 className="text-base font-semibold text-ink-900">Your bill</h3>
                  <p className="text-sm text-ink-500">
                    Worked out from the distance and the size. Accept it and nearby riders are alerted straight away — or
                    name your own price and they can take it, counter, or pass.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <SummaryBlock title="Collecting from" address={pickup.address} contact={`${pickup.contactName} · ${pickup.contactPhone}`} />
                    <SummaryBlock title="Delivering to" address={destination.address} contact={`${destination.contactName} · ${destination.contactPhone}`} />
                  </div>

                  {quote && (
                    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                      <PriceBreakdown
                        lines={quote.lines}
                        totalKobo={quote.totalKobo}
                        meta={{
                          distanceKm: quote.distanceKm,
                          durationMinutes: quote.durationMinutes,
                          routeSource: quote.routeSource,
                          zoneName: quote.zone?.name,
                        }}
                      />
                    </div>
                  )}

                  {quote && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setDecision('ACCEPT')}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors',
                          decision === 'ACCEPT'
                            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <p className="text-sm font-semibold text-ink-900">Accept the bill</p>
                        <p className="text-xs text-ink-500">Riders see {formatNaira(quote.totalKobo)}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecision('NEGOTIATE');
                          if (!offerNaira) setOfferNaira(String(nairaOf(quote.totalKobo)));
                        }}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors',
                          decision === 'NEGOTIATE'
                            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30'
                            : 'border-ink-200 hover:border-ink-300',
                        )}
                      >
                        <p className="text-sm font-semibold text-ink-900">Negotiate</p>
                        <p className="text-xs text-ink-500">Name the price you want to pay</p>
                      </button>
                    </div>
                  )}

                  {decision === 'NEGOTIATE' && quote && (
                    <div className="space-y-2 rounded-xl border border-ink-200 p-3">
                      <Field
                        label="What do you want to pay?"
                        required
                        error={fieldErrors['askKobo']}
                        hint={`Riders see this instead of the bill. Between ${formatNaira(Number(quote.totalKobo) / 2)} and ${formatNaira(Number(quote.totalKobo) * 3)}.`}
                        htmlFor="ask-amount"
                      >
                        <Input
                          id="ask-amount"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="50"
                          value={offerNaira}
                          error={fieldErrors['askKobo']}
                          onChange={(event) => setOfferNaira(event.target.value)}
                        />
                      </Field>
                      <p className="text-xs text-ink-500">
                        A rider may accept this, ask for more, or pass. You decide on any price they ask for — nothing is
                        charged until a rider has the job.
                      </p>
                    </div>
                  )}

                  {fieldErrors['decision'] && <p className="text-xs font-medium text-danger-700">{fieldErrors['decision']}</p>}

                  <label className="flex items-start gap-2.5 rounded-xl border border-ink-200 p-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-ink-300"
                      checked={acceptTerms}
                      onChange={(event) => setAcceptTerms(event.target.checked)}
                      aria-describedby="terms-note"
                    />
                    <span id="terms-note">
                      <span className="text-sm font-medium text-ink-800">I accept the delivery terms</span>
                      <span className="block text-xs text-ink-500">
                        Prohibited items are not allowed. The recipient must be reachable at the phone number given.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-ink-200 pt-4">
                <Button variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={next}>Continue</Button>
                ) : (
                  <Button
                    onClick={() => {
                      if (validateStep(3)) void submit();
                    }}
                    isLoading={createDelivery.isPending}
                    disabled={!quote || decision === 'NONE' || !acceptTerms}
                  >
                    {decision === 'NEGOTIATE'
                      ? `Offer ${offerNaira ? `₦${Number(offerNaira.replace(/,/g, '')).toLocaleString('en-NG')}` : 'your price'} to riders`
                      : quote
                        ? `Accept and alert riders — ${formatNaira(quote.totalKobo)}`
                        : 'Send to riders'}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Live price panel */}
          <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardHeader title="Your price" subtitle="Before you confirm" />
              <CardBody>
                {!bothLocated && <p className="text-sm text-ink-500">Choose a pickup and a drop-off to see the price.</p>}
                {bothLocated && pricing && !quote && <p className="text-sm text-ink-500">Pricing…</p>}
                {quoteError != null && (
                  <Alert tone="danger" title="We cannot price this trip">
                    {useApiError(quoteError)}
                  </Alert>
                )}
                {quote && !quoteError && (
                  <PriceBreakdown
                    lines={quote.lines}
                    totalKobo={quote.totalKobo}
                    compact
                    meta={{
                      distanceKm: quote.distanceKm,
                      durationMinutes: quote.durationMinutes,
                      routeSource: quote.routeSource,
                      zoneName: quote.zone?.name,
                    }}
                  />
                )}
              </CardBody>
            </Card>
            <p className="px-1 text-xs leading-relaxed text-ink-400">
              Nothing is charged until you confirm, and the total is shown again on the delivery page
              rules. Payment — card, transfer or wallet — is taken on the delivery page, never before you confirm.
            </p>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

function SummaryBlock({ title, address, contact }: { title: string; address: string; contact: string }) {
  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      <p className="mt-1 text-sm font-medium text-ink-900">{address}</p>
      <p className="mt-0.5 text-xs text-ink-500">{contact}</p>
    </div>
  );
}

export type { Quote };
