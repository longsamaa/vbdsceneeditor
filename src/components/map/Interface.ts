import * as THREE from 'three'
import type {CustomLayerInterface} from 'maplibre-gl';
import {OverscaledTileID} from 'maplibre-gl';
import type {ShadowLitMaterial} from './shadow/ShadowLitMaterial';
import type {ShadowRenderTarget} from './shadow/ShadowRenderTarget';
import { MaplibreShadowMesh } from './shadow/ShadowGeometry';

export interface LocalCoordinate {
    tileX: number,
    tileY: number,
    tileZ: number,
    coordX: number,
    coordY: number
}
export interface LatLon {
    lat: number,
    lon: number
}
export interface ObjectInfo {
    id?: string;
    name?: string;
    object3d?: THREE.Object3D;
    localCoordX?: number;
    localCoordY?: number;
    scale?: number;
    bearing?: number;
    modelType?: string;
    textureUrl?: string;
    textureName?: string;
    modelName?: string;
    modelUrl?: string;
    mixer: THREE.AnimationMixer | null;
    actions: THREE.AnimationAction[] | null;
    animations: THREE.AnimationClip[] | null;
    shadowMaterial?: ShadowLitMaterial | null;
}
export interface ModelData {
    object3d?: THREE.Object3D | null;
    animations: THREE.AnimationClip[] | null;
}
export interface DataTileInfo {
    objects?: Array<ObjectInfo>;
    overScaledTileID?: OverscaledTileID;
    state?: string;
    sceneTile?: THREE.Scene;
    stateDownload?: string;
}
export type SunOptions = {
    shadow: boolean;
    altitude: number;
    azimuth: number;
    lat : number | null;
    lon : number | null;
}
export type SunParamater = {
    altitude: number;
    azimuth: number;
    sun_dir: THREE.Vector3;
    shadow: boolean;
    lat : number | null;
    lon : number | null;
}
export type PickHit = {
    dist: number;
    tileKey: string;
    overScaledTileId: OverscaledTileID,
    object: THREE.Object3D
}
export type UserData = {
    isModelRoot: boolean,
    scaleUnit: number,
    tile: {
        z: number,
        x: number,
        y: number,
    }
    mixer: THREE.AnimationMixer | null,
}
export type ShadowUserData = {
    scale_unit : number
}

export type LightGroupOption = {
    directional?: {
        intensity?: number;
        color?: THREE.ColorRepresentation;
        direction?: THREE.Vector3;
    };
    hemisphere?: {
        intensity?: number;
        skyColor?: THREE.ColorRepresentation;
        groundColor?: THREE.ColorRepresentation;
    };
    ambient?: {
        intensity?: number;
        color?: THREE.ColorRepresentation;
    };
};

export type LightGroup = THREE.Group & {
    dirLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
    ambientLight: THREE.AmbientLight;
};


export type ShadowParam = {
    shadowRenderTarget: ShadowRenderTarget;
    shadowMatrix: THREE.Matrix4;
    lightDir: THREE.Vector3;
    renderer: THREE.WebGLRenderer;
}

export type Custom3DTileRenderLayer = CustomLayerInterface & {
    visible : boolean,
    onPick?: (info: PickHit) => void,
    onPickfail?: () => void,
    layerSourceCastShadow: Custom3DTileRenderLayer | null,
    getShadowParam(): ShadowParam | undefined,
    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void,
}

export type ShadowPair = {
    scaleUnit: number;
    shadowMesh: MaplibreShadowMesh;
}



