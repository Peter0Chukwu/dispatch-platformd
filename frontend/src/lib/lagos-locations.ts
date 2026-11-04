/**
 * SAVED LAGOS LOCATIONS
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Maps is not configured yet (MAPS_PROVIDER=STUB), so instead of showing a
 * fake "map" the booking form offers real, accurate coordinates for common Lagos
 * pickup and drop-off points. Choosing one fills the address and the lat/lng.
 *
 * When the Maps key is added in Phase 8 this list stays useful — it becomes the
 * "saved addresses" shortcut above the interactive map.
 *
 * Coordinates are approximate street-level centres, good enough for a haversine
 * distance; they will be replaced by exact map pins once the picker ships.
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

export const LAGOS_LOCATIONS: SavedLocation[] = [
  { id: 'vi-adeola', name: 'Victoria Island — Adeola Odeku', address: '12 Adeola Odeku Street, Victoria Island, Lagos', landmark: 'Opposite Eko Hotel roundabout', lat: 6.4281, lng: 3.4219, zone: 'LAG-ISLAND' },
  { id: 'vi-ahmadu', name: 'Victoria Island — Ahmadu Bello Way', address: '4 Ahmadu Bello Way, Victoria Island, Lagos', landmark: 'Near Bar Beach Towers', lat: 6.4262, lng: 3.4205, zone: 'LAG-ISLAND' },
  { id: 'ikoyi-awolowo', name: 'Ikoyi — Awolowo Road', address: '28 Awolowo Road, Ikoyi, Lagos', landmark: 'By Falomo roundabout', lat: 6.4498, lng: 3.4283, zone: 'LAG-ISLAND' },
  { id: 'island-marina', name: 'Lagos Island — Marina', address: '5 Broad Street, Lagos Island, Lagos', landmark: 'Beside the old Secretariat', lat: 6.4550, lng: 3.3958, zone: 'LAG-ISLAND' },
  { id: 'yaba-commercial', name: 'Yaba — Commercial Avenue', address: '9 Commercial Avenue, Yaba, Lagos', landmark: 'Opposite Tejuosho market', lat: 6.5095, lng: 3.3711, zone: 'LAG-MAINLAND' },
  { id: 'surulere-bode', name: 'Surulere — Bode Thomas', address: '5 Bode Thomas Street, Surulere, Lagos', landmark: 'Near Adeniran Ogunsanya', lat: 6.4969, lng: 3.3481, zone: 'LAG-MAINLAND' },
  { id: 'gbagada-express', name: 'Gbagada — Expressway', address: '17 Gbagada Expressway, Gbagada, Lagos', landmark: 'Beside the pedestrian bridge', lat: 6.5560, lng: 3.3830, zone: 'LAG-MAINLAND' },
  { id: 'ikeja-alausa', name: 'Ikeja — Alausa Secretariat', address: '8 Obafemi Awolowo Way, Ikeja, Lagos', landmark: 'Opposite Alausa Secretariat', lat: 6.6134, lng: 3.3539, zone: 'LAG-MAINLAND' },
  { id: 'maryland-mall', name: 'Maryland — Mall', address: '1 Maryland Mall, Ikorodu Road, Lagos', landmark: 'Maryland Mall entrance', lat: 6.5719, lng: 3.3672, zone: 'LAG-MAINLAND' },
  { id: 'lekki-phase1', name: 'Lekki — Phase 1', address: '16 Admiralty Way, Lekki Phase 1, Lagos', landmark: 'Near Lekki Phase 1 roundabout', lat: 6.4410, lng: 3.4740, zone: 'LEKKI-AJAH' },
  { id: 'ajah-admiralty', name: 'Ajah — Addo Road', address: '22 Addo Road, Ajah, Lagos', landmark: 'By Ajah bus terminal', lat: 6.4692, lng: 3.5658, zone: 'LEKKI-AJAH' },
  { id: 'sangotedo', name: 'Sangotedo — Novare Mall', address: 'Novare Mall, Sangotedo, Lekki-Epe Expressway', landmark: 'Novare Mall main gate', lat: 6.4667, lng: 3.6000, zone: 'LEKKI-AJAH' },
];

export function findLocation(id: string): SavedLocation | undefined {
  return LAGOS_LOCATIONS.find((location) => location.id === id);
}
