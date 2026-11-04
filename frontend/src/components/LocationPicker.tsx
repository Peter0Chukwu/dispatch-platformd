import { useMemo, useState } from 'react';
import { LAGOS_LOCATIONS, type SavedLocation } from '../lib/lagos-locations';
import { Input, Field } from './ui';
import { cn } from '../lib/cn';

/**
 * Address entry with saved Lagos locations.
 *
 * The Google Maps picker is not configured yet, so this is a searchable list of
 * real coordinates rather than a decorative map. Honest, and it keeps the
 * distance calculation accurate in the meantime.
 */
export function LocationPicker({
  title,
  selectedId,
  onSelect,
  address,
  landmark,
  onAddressChange,
  onLandmarkChange,
  contactName,
  contactPhone,
  onContactNameChange,
  onContactPhoneChange,
  errors = {},
}: {
  title: string;
  selectedId: string | null;
  onSelect: (location: SavedLocation) => void;
  address: string;
  landmark: string;
  onAddressChange: (value: string) => void;
  onLandmarkChange: (value: string) => void;
  contactName: string;
  contactPhone: string;
  onContactNameChange: (value: string) => void;
  onContactPhoneChange: (value: string) => void;
  errors?: Record<string, string | undefined>;
}) {
  const [search, setSearch] = useState('');

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return LAGOS_LOCATIONS;
    return LAGOS_LOCATIONS.filter(
      (location) =>
        location.name.toLowerCase().includes(needle) ||
        location.address.toLowerCase().includes(needle) ||
        location.landmark.toLowerCase().includes(needle),
    );
  }, [search]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Pick a saved location, or type the full address. The map picker arrives with Google Maps in Phase 8.
        </p>
      </div>

      <Input
        label="Search saved locations"
        placeholder="e.g. Lekki, Yaba, Ikeja"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {matches.map((location) => (
          <button
            key={location.id}
            type="button"
            onClick={() => onSelect(location)}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors',
              selectedId === location.id
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30'
                : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
            )}
          >
            <p className="text-sm font-semibold text-ink-900">{location.name}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{location.address}</p>
          </button>
        ))}
        {matches.length === 0 && (
          <p className="col-span-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-500">
            No saved location matches “{search}”. Type the address manually below — we will still price it
            from the coordinates you enter.
          </p>
        )}
      </div>

      <Field label="Street address" required error={errors.address} htmlFor={`${title}-address`}>
        <Input
          id={`${title}-address`}
          placeholder="House number, street, area, city"
          value={address}
          error={errors.address}
          onChange={(event) => onAddressChange(event.target.value)}
        />
      </Field>

      <Field label="Landmark" hint="Helps the rider find you" htmlFor={`${title}-landmark`}>
        <Input
          id={`${title}-landmark`}
          placeholder="e.g. beside the yellow filling station"
          value={landmark}
          onChange={(event) => onLandmarkChange(event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" required error={errors.contactName} htmlFor={`${title}-contact`}>
          <Input
            id={`${title}-contact`}
            placeholder="Who is at this address?"
            value={contactName}
            error={errors.contactName}
            onChange={(event) => onContactNameChange(event.target.value)}
          />
        </Field>
        <Field label="Contact phone" required error={errors.contactPhone} htmlFor={`${title}-phone`}>
          <Input
            id={`${title}-phone`}
            inputMode="tel"
            placeholder="0803 123 4567"
            value={contactPhone}
            error={errors.contactPhone}
            onChange={(event) => onContactPhoneChange(event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
