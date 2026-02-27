// Coordinate boundary box (Corvallis area)
export const MAP_BOUNDS = {
  west: -123.3569134930475,
  south: 44.53938888888889,
  east: -123.21991666666667,
  north: 44.621307472972724,
} as const;

export function isWithinMapBounds(lat: number, lng: number): boolean {
  return (
    lat >= MAP_BOUNDS.south &&
    lat <= MAP_BOUNDS.north &&
    lng >= MAP_BOUNDS.west &&
    lng <= MAP_BOUNDS.east
  );
}
