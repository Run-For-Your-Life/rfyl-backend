import difference from '@turf/difference';
import union from '@turf/union';
import { featureCollection } from '@turf/helpers';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeometryOps } from './realtimeEngine';
import type { TerritoryFeature } from './realtimeTypes';

type TurfPolygon = Feature<Polygon | MultiPolygon>;

export function createGeometryOps(): GeometryOps {
  return {
    union: (territory: TerritoryFeature, captured: TerritoryFeature) => {
      const collection = toFeatureCollection(territory, captured);
      const result = union(collection);
      return result ? toTerritoryFeature(result, territory.properties.userId) : territory;
    },
    difference: (territory: TerritoryFeature, captured: TerritoryFeature) => {
      const collection = toFeatureCollection(territory, captured);
      const result = difference(collection);
      return result ? toTerritoryFeature(result, territory.properties.userId) : null;
    },
  };
}

function toTurfFeature(territory: TerritoryFeature): TurfPolygon {
  return territory as unknown as TurfPolygon;
}

function toFeatureCollection(
  first: TerritoryFeature,
  second: TerritoryFeature
): FeatureCollection<Polygon | MultiPolygon> {
  return featureCollection([toTurfFeature(first), toTurfFeature(second)]);
}

function toTerritoryFeature(feature: TurfPolygon, userId: string): TerritoryFeature {
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      userId,
      updatedAt: Date.now(),
    },
  };
}
