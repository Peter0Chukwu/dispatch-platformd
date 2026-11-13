/**
 * SAVED BENIN CITY LOCATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Maps is not configured yet (MAPS_PROVIDER=STUB), so instead of showing a
 * fake "map" the booking form offers real, accurate coordinates for common Benin
 * City pickup and drop-off points. Choosing one fills the address and the lat/lng.
 *
 * When the Maps key is added the list stays useful — it becomes the "saved
 * addresses" shortcut above the interactive map.
 *
 * Coordinates are approximate street-level centres, good enough for a haversine
 * distance; they will be replaced by exact map pins once the picker ships.
 *
 * The `zone` tag is the seeded zone code the point falls inside, used only as a
 * hint in the form. The server always re-resolves the zone from the coordinates,
 * so a wrong tag here can never change a price.
 */
export interface SavedLocation {
  id: string;
  name: string;
  address: string;
  landmark: string;
  lat: number;
  lng: number;
  zone: string;
}

export const BENIN_CITY_LOCATIONS: SavedLocation[] = [
  { id: 'ring-road', name: 'Ring Road — Oba Ovonramwen Square', address: 'Ring Road, Oba Ovonramwen Square, Benin City', landmark: 'By the palace roundabout', lat: 6.3330, lng: 5.6220, zone: 'BEN-CENTRAL' },
  { id: 'new-benin', name: 'New Benin — Mission Road', address: 'Mission Road, New Benin Market, Benin City', landmark: 'Opposite the market gate', lat: 6.3373, lng: 5.6337, zone: 'BEN-CENTRAL' },
  { id: 'akpakpava', name: 'Akpakpava Road', address: 'Akpakpava Road, Benin City', landmark: 'Near the Central Mosque', lat: 6.3395, lng: 5.6280, zone: 'BEN-CENTRAL' },
  { id: 'gra-adesuwa', name: 'GRA — Adesuwa Road', address: 'Adesuwa Road, GRA, Benin City', landmark: 'By Adesuwa Primary School', lat: 6.3312, lng: 5.6392, zone: 'BEN-CENTRAL' },
  { id: 'siluko', name: 'Siluko Road', address: 'Siluko Road, Benin City', landmark: 'Off Sapele Road, by Siluko junction', lat: 6.3180, lng: 5.6290, zone: 'BEN-CENTRAL' },
  { id: 'ugbowo-complex', name: 'Ugbowo — Shopping Complex', address: 'Ugbowo-Lagos Road, Ugbowo, Benin City', landmark: 'Ugbowo Shopping Complex', lat: 6.3960, lng: 5.6110, zone: 'BEN-UGBOWO' },
  { id: 'ubth', name: 'Ugbowo — UBTH', address: 'Ugbowo-Lagos Road, Benin City', landmark: 'University of Benin Teaching Hospital main gate', lat: 6.3906, lng: 5.6122, zone: 'BEN-UGBOWO' },
  { id: 'uselu', name: 'Uselu — Market Road', address: 'Uselu Market Road, Benin City', landmark: 'By Uselu market', lat: 6.3720, lng: 5.6210, zone: 'BEN-UGBOWO' },
  { id: 'ikpoba-hill', name: 'Ikpoba Hill', address: 'Benin-Auchi Road, Ikpoba Hill, Benin City', landmark: 'By the Ikpoba River bridge', lat: 6.3565, lng: 5.6691, zone: 'BEN-IKPOBA' },
  { id: 'aduwawa', name: 'Aduwawa', address: 'Aduwawa, Benin-Auchi Road, Benin City', landmark: 'Near Aduwawa market', lat: 6.3629, lng: 5.6791, zone: 'BEN-IKPOBA' },
  { id: 'airport-road', name: 'Airport Road — Benin Airport', address: 'Airport Road, Benin City', landmark: 'By the airport terminal', lat: 6.3169, lng: 5.5994, zone: 'BEN-SAPELE' },
  { id: 'sapele-road', name: 'Sapele Road — Oregbeni', address: 'Sapele Road, Benin City', landmark: 'By Oregbeni market', lat: 6.2771, lng: 5.6337, zone: 'BEN-SAPELE' },
];

export function findLocation(id: string): SavedLocation | undefined {
  return BENIN_CITY_LOCATIONS.find((location) => location.id === id);
}
