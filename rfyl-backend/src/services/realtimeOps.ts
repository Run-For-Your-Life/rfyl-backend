import turfDifference from '@turf/difference';
import { featureCollection } from '@turf/helpers';
import turfUnion from '@turf/union';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

import type { GeometryOps } from './realtimeEngine';
import type { TerritoryFeature } from './realtimeTypes';

type TurfPolygon = Feature<Polygon | MultiPolygon>;

export function createGeometryOps(): GeometryOps {
  return {
    union: (territory: TerritoryFeature, captured: TerritoryFeature) => {
      const collection = toFeatureCollection(territory, captured);
      const result = turfUnion(collection);
      if (process.env.DEBUG_CAPTURE === '1') {
        console.warn('[capture] union', {
          inputType: territory.geometry.type,
          capturedType: captured.geometry.type,
          outputType: result?.geometry.type,
        });
      }
      return result ? toTerritoryFeature(result, territory.properties.userId) : territory;
    },
    difference: (territory: TerritoryFeature, captured: TerritoryFeature) => {
      const collection = toFeatureCollection(territory, captured);
      const result = turfDifference(collection);
      if (process.env.DEBUG_CAPTURE === '1') {
        console.warn('[capture] difference', {
          inputType: territory.geometry.type,
          capturedType: captured.geometry.type,
          outputType: result?.geometry.type,
        });
      }
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
