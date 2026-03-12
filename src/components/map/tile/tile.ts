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
        const modelType = properties.modeltype as string;
        if (modelType !== 'Object' && modelType !== 'glb') {
            continue;
        }
        const pt = geometry[0][0]; // Point đầu tiên
        const object3d: ObjectInfo = {
            localCoordX: pt.x /** (8192 / extent)*/,
            localCoordY: pt.y /** (8192 / extent)*/,
            gid: properties.gid as string,
            id: properties.id as string,
            bearing: properties.bearing as number,
            modelName: properties.modelname as string,
            modelUrl: properties.modelurl as string,
            modelType: properties.modeltype as string,
            textureName: properties.texturename as string,
            textureUrl: properties.textureurl as string,
            scale: properties.scale as number,
            startdate: properties.startdate as string,
            enddate: properties.enddate as string,
            mixer : null,
            animations : null,
            actions : null
        };
        lstObject3d.push(object3d);
    }
    return lstObject3d;
}

