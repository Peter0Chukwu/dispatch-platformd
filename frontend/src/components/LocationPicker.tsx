import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LAGOS_LOCATIONS, type SavedLocation } from '../lib/lagos-locations';
import { api } from '../lib/api';
import { Button, Input, Field } from './ui';
import { cn } from '../lib/cn';

/**
 * ADDRESS ENTRY
 *
 * Suggestions come from `GET /maps/places`, which is the server's map adapter:
 * Google Places when a key is configured, the platform's own Lagos table when it
 * is not. Either way the coordinates are real, and the hint under the list says
 * which source answered so nobody assumes street-level accuracy that is not there.
 *
 * Coordinates are never typed by the customer: choosing a suggestion fills the
 * address AND the lat/lng, and the server re-measures the distance from those
 * coordinates when it prices the trip. "Find coordinates" is the manual escape
 * hatch — it geocodes what was typed and says so plainly when nothing matches.
 */

interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
  source: 'STUB' | 'GOOGLE' | 'MAPBOX';
}

const toSavedLocation = (place: PlaceSuggestion): SavedLocation => ({
  id: place.id,
  name: place.name,
  address: place.address,
  landmark: place.landmark ?? '',
  lat: place.lat,
  lng: place.lng,
  zone: 'LAG',
});

const useDebounced = (value: string, delay = 300) => {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDeferred(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return deferred;
};
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
  const [resolved, setResolved] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'searching' | 'missing'>('idle');
  const debounced = useDebounced(search.trim());

  // Server-side suggestions. `keepPreviousData`-style behaviour keeps the saved
  // list visible while the first request is in flight, so the panel never blanks.
  const suggestions = useQuery({
    queryKey: ['maps', 'places', debounced],
    queryFn: () => api.get<{ data: PlaceSuggestion[]; provider: string }>(`/maps/places?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  });

  const matches: SavedLocation[] = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return LAGOS_LOCATIONS;
    const remote = suggestions.data?.data ?? [];
    if (remote.length > 0) {
      // Only what actually matched: padding the list with unrelated saved places
      // would make a search for "lekki" appear to offer Victoria Island.
      return remote.map(toSavedLocation).slice(0, 8);
    }
    return LAGOS_LOCATIONS.filter(
      (location) =>
        location.name.toLowerCase().includes(needle) ||
        location.address.toLowerCase().includes(needle) ||
        location.landmark.toLowerCase().includes(needle),
    );
  }, [search, suggestions.data]);

  const provider = suggestions.data?.provider ?? 'stub';

  const findCoordinates = async () => {
    if (address.trim().length < 3) return;
    setLookupState('searching');
    try {
      const result = await api.get<{ data: { address: string; lat: number; lng: number; source: string; approximate: boolean } | null }>(
        `/maps/geocode?address=${encodeURIComponent(address)}`,
      );
      if (!result.data) {
        setLookupState('missing');
        setResolved(null);
        return;
      }
      setLookupState('idle');
      setResolved({ lat: result.data.lat, lng: result.data.lng, address: result.data.address });
      onSelect({
        id: `geocoded-${result.data.lat}-${result.data.lng}`,
        name: result.data.address,
        address: result.data.address,
        landmark: result.data.approximate ? 'Approximate match — add a landmark' : '',
        lat: result.data.lat,
        lng: result.data.lng,
        zone: 'LAG',
      });
    } catch {
      setLookupState('missing');
      setResolved(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Search a place, choose the suggestion that matches, then add the landmark the rider will look for.
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
            Nothing matches “{search}”. Type the full address below and press <strong>Find coordinates</strong> —
            we will price it from whatever we can locate, or tell you we could not.
          </p>
        )}
      </div>

      <p className="text-[11px] text-ink-400">
        {suggestions.isFetching
          ? 'Searching…'
          : provider === 'google'
            ? 'Suggestions from Google Places.'
            : 'Suggestions from the platform’s saved Lagos locations — exact coordinates, no street-level geocoding until a maps key is configured.'}
      </p>

      <Field label="Street address" required error={errors.address} htmlFor={`${title}-address`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${title}-address`}
            placeholder="House number, street, area, city"
            value={address}
            error={errors.address}
            onChange={(event) => {
              onAddressChange(event.target.value);
              setResolved(null);
              setLookupState('idle');
            }}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void findCoordinates()}
            isLoading={lookupState === 'searching'}
            disabled={address.trim().length < 3}
          >
            Find coordinates
          </Button>
        </div>
      </Field>

      {resolved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          Located at {resolved.lat.toFixed(4)}, {resolved.lng.toFixed(4)} — the price is measured from this point.
        </p>
      )}
      {lookupState === 'missing' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          We could not locate that address. Pick a suggestion above, or add a clearer street name — a booking needs
          real coordinates, so we will not invent them.
        </p>
      )}

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
