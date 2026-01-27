import {VectorTile} from '@mapbox/vector-tile';
import Protobuf from 'pbf';

export function parseVectorTile(buffer: ArrayBuffer): VectorTile {
    const pbf = new Protobuf(buffer);
    return new VectorTile(pbf);
}

export function getLayerFeatures(tile: VectorTile, layerName: string): any {
    const layer = tile.layers[layerName];
    if (!layer) {
        console.warn(`Layer ${layerName} not found`);
        return [];
    }

    const features = [];
    for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        features.push({
            type: feature.type, // 1=Point, 2=LineString, 3=Polygon
            properties: feature.properties,
            geometry: feature.loadGeometry(),
            id: feature.id
        });
    }
    return features;
}