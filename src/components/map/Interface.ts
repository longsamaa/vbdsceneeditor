import * as THREE from 'three'
import {OverscaledTileID} from 'maplibre-gl';
import type {
    CustomLayerInterface
} from 'maplibre-gl';
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
}
export type SunParamater = {
    altitude: number;
    azimuth: number;
    sun_dir: THREE.Vector3;
    shadow: boolean;
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
export type Custom3DTileRenderLayer = CustomLayerInterface & {
    visible : boolean,
    onPick?: (info: PickHit) => void,
    onPickfail?: () => void,
}


