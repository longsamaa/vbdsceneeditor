import {VectorTile} from '@mapbox/vector-tile';
import type {ObjectInfo} from "../Interface.ts"
import type {JsonVectorTileLayer} from "../source/GeojsonConverter.ts";

export function parseLayerTileInfo(layer: JsonVectorTileLayer): Array<ObjectInfo> {
    const lstObject3d: Array<ObjectInfo> = new Array<ObjectInfo>();
    for (let i = 0; i < layer.features.length; i++) {
        const feature = layer.features[i];
        // Chỉ xử lý Point features (type === 'Point')
        if (feature.type !== 'Point') {
            continue;
        }
        const properties = feature.properties;
        const geometry = feature.geometry;
        // Kiểm tra geometry có data
        if (!geometry || geometry.length === 0 || geometry[0].length === 0) {
            continue;
        }
        const pt = geometry[0][0]; // Point đầu tiên
        const object3d: ObjectInfo = {
            localCoordX: pt.x /** (8192 / extent)*/,
            localCoordY: pt.y /** (8192 / extent)*/,
            id: properties.id as string,
            bearing: properties.bearing as number,
            modelName: properties.modelname as string,
            modelUrl: properties.modelurl as string,
            modelType: properties.modeltype as string,
            textureName: properties.texturename as string,
            textureUrl: properties.textureurl as string,
            scale: properties.scale as number,
            mixer : null,
            animations : null,
            actions : null
        };
        // Only push if all required properties exist
        if (object3d.modelName && object3d.modelUrl && object3d.modelType &&
            object3d.textureName && object3d.textureUrl) {
            lstObject3d.push(object3d);
        }
    }

    return lstObject3d;
}

export function parseTileInfo(tile: VectorTile, sourceLayer: string): Array<ObjectInfo> {
    const layer = tile.layers[sourceLayer];
    const extent = layer.extent;
    const lstObject3d: Array<ObjectInfo> = new Array<ObjectInfo>();
    for (let i = 0; i < layer.length; i++) {
        const object3d: ObjectInfo = {};
        const feature = layer.feature(i);
        const type = feature.type;
        if (type != 1) {
            continue;
        }
        const properties = feature.properties;
        const geometries = feature.loadGeometry();
        const pt = geometries[0][0];
        object3d.localCoordX = pt.x * (8192 / extent);
        object3d.localCoordY = pt.y * (8192 / extent);
        object3d.id = properties.id as string;
        object3d.bearing = properties.bearing as number;
        object3d.modelName = properties.modelname as string;
        object3d.modelUrl = properties.modelurl as string;
        object3d.modelType = properties.modeltype as string;
        object3d.textureName = properties.texturename as string;
        object3d.textureUrl = properties.textureurl as string;
        object3d.scale = properties.scale as number;
        // Only push if all required properties exist
        if (object3d.modelName && object3d.modelUrl && object3d.modelType &&
            object3d.textureName && object3d.textureUrl) {
            lstObject3d.push(object3d);
        }
    }
    return lstObject3d;
}