/**
 * The shape every map lookup returns, whatever the provider.
 *
 * Google, Mapbox or the built-in stub all answer with these objects, so nothing
 * downstream — the booking form, tracking, the admin map — needs to know which one
 * is configured. It also means the UI can label results honestly: `source: 'STUB'`
 * says "these are real coordinates from our own Benin City table, not a geocoder".
 */
export interface PlaceResult {
  /** Stable id ('vi-adeola' for the stub, `place_id` for Google). */
  id: string;
  /** Short label for a dropdown. */
  name: string;
  /** Full postal-style address shown under the name. */
  address: string;
  landmark: string | null;
  lat: number;
  lng: number;
  /** Which service produced this row. */
  source: 'STUB' | 'GOOGLE' | 'MAPBOX';
}

export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  source: 'STUB' | 'GOOGLE' | 'MAPBOX';
  /** True when the coordinates are approximate (stub) rather than surveyed. */
  approximate: boolean;
}
