export type GeoPoint = {
  lat: number;
  lng: number;
  ts: number;
  accuracy?: number;
};

export type TerritoryGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export type TerritoryFeature = {
  type: 'Feature';
  geometry: TerritoryGeometry;
  properties: {
    userId: string;
    updatedAt: number;
  };
};

export type PathFeature = {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
  properties: {
    userId: string;
    updatedAt: number;
  };
};

export type GhostState = 'ghost_invulnerable' | 'ghost_vulnerable' | 'runner';
export type AnticheatLockReason = 'speed_violation';

export type PlayerState = {
  userId: string;
  username: string;
  colornum: number;
  territory: TerritoryFeature | null;
  path: GeoPoint[];
  isOutside: boolean;
  ghostState: GhostState;
  ghostEligible: boolean;
  pathLengthMeters: number;
  territoryAreaSqMeters: number;
  lastPoint?: GeoPoint;
  lastInsidePoint?: GeoPoint;
  anticheatLockPoint?: GeoPoint;
  anticheatLockReason?: AnticheatLockReason;
};

export type MapState = {
  mapId: string;
  players: Map<string, PlayerState>;
};
