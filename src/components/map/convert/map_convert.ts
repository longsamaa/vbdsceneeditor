import type {LatLon, LocalCoordinate} from '../Interface.ts'

const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

const LATITUDE_MAX = 85.05112878;
const TILE_SIZE = 512;
const EARTH_RADIUS_M = 6378137.0;
const M2PI = Math.PI * 2;
const EXTENT = 8192.0;

export function clamp(value: number,
                      min: number,
                      max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function deg2rad(deg: number): number {
    return deg * Math.PI / 180;
}

export function worldSize(scale: number): number {
    return scale * TILE_SIZE;
}

export function getMetersPerPixelAtLatitude(lat: number, zoom: number): number {
    const constrainedZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const constrainedScale = Math.pow(2, constrainedZoom);
    const constrainedLat = clamp(lat, -LATITUDE_MAX, LATITUDE_MAX);

    return Math.cos(deg2rad(constrainedLat)) *
        M2PI * EARTH_RADIUS_M /
        worldSize(constrainedScale);
}

export function getMetersPerExtentUnit(lat: number, z: number): number {
    const scale_512 = 1 / getMetersPerPixelAtLatitude(lat, z);
    return (scale_512 * EXTENT) * 1 / TILE_SIZE;
};

export function tileLocalToLatLon(
    z: number,
    tileX: number,
    tileY: number,
    coordX: number,
    coordY: number,
    extent: number = 8192
): LatLon {
    const scale = extent * Math.pow(2, z);
    const lon = ((tileX * extent + coordX) / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * (tileY * extent + coordY)) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    const result: LatLon = {lat: lat, lon: lon};
    return result;
};

export function latlonToLocal(
    lon: number,
    lat: number,
    z: number,
    extent: number = 8192
): LocalCoordinate {
    const scale = extent * Math.pow(2, z);
    const x = ((lon + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = ((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale);
    const tileX = Math.floor(x / extent);
    const tileY = Math.floor(y / extent);
    const localX = x % extent;
    const localY = y % extent;
    const result: LocalCoordinate = {
        tileX: tileX,
        tileY: tileY,
        tileZ: z,
        coordX: localX,
        coordY: localY
    };
    return result;
};

export function clampZoom(minZoom: number, maxZoom: number, z: number): number {
    return Math.max(minZoom, Math.min(maxZoom, z));
}