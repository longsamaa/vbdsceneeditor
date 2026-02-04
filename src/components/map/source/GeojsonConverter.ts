import {VectorTile, VectorTileFeature} from '@mapbox/vector-tile';
import Point from '@mapbox/point-geometry';
import * as THREE from "three";
// @ts-ignore
import earcut from 'earcut';

export type JsonVectorTile = {
    layers: Record<string, JsonVectorTileLayer>;
}
export type JsonVectorTileLayer = {
    name: string;
    extent: number;
    features: JsonVectorTileFeature[];
}
export type JsonVectorTileFeature = {
    id?: number | string;
    type: 'Point' | 'LineString' | 'Polygon';
    geometry: Point[][]; // đã decode
    properties: Record<string, number | string | boolean>;
}

function featureTypeToString(type: number): 'Point' | 'LineString' | 'Polygon' {
    switch (type) {
        case 1:
            return 'Point';
        case 2:
            return 'LineString';
        case 3:
            return 'Polygon';
        default:
            throw new Error('Unknown feature type');
    }
}

function decodeGeometry(
    feature: VectorTileFeature,
    extent: number
): Point[][] {
    const scale = 8192 / extent;
    const geom = feature.loadGeometry(); // Point[][]
    if (!geom || geom.length === 0) {
        return [];
    }
    return geom.map(ring =>
        ring.map(p => new Point(p.x * scale, p.y * scale))
    );
}

export function vectorTileToJSON(
    tile: VectorTile
): JsonVectorTile {
    const result: JsonVectorTile = {
        layers: {}
    };
    for (const layerName in tile.layers) {
        const layer = tile.layers[layerName];
        const jsonLayer: JsonVectorTileLayer = {
            name: layerName,
            extent: layer.extent,
            features: []
        };
        for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i);
            const jsonFeature: JsonVectorTileFeature = {
                id: feature.id,
                type: featureTypeToString(feature.type),
                geometry: decodeGeometry(feature, layer.extent),
                properties: feature.properties
            };
            jsonLayer.features.push(jsonFeature);
        }
        result.layers[layerName] = jsonLayer;
    }
    return result;
}

export function buildGeo(vertices: number[], indices: number[]): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    // Validate
    if (vertices.length === 0 || vertices.length % 2 !== 0) {
        return geometry;
    }
    const vertexCount = vertices.length / 2;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    // Tìm bounding box để normalize UV
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i];
        const y = vertices[i + 1];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    // ✅ Efficient loop - build positions và UVs
    let posIdx = 0;
    let uvIdx = 0;
    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i];
        const y = vertices[i + 1];
        // Position
        positions[posIdx++] = x;
        positions[posIdx++] = y;
        positions[posIdx++] = 0;
        // UV (normalize về 0-1)
        uvs[uvIdx++] = width > 0 ? (x - minX) / width : 0;
        uvs[uvIdx++] = height > 0 ? (y - minY) / height : 0;
    }
    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(uvs, 2)
    );
    if (indices && indices.length > 0) {
        geometry.setIndex(indices);
    }
    geometry.computeVertexNormals();
    return geometry;
}

export function triangulateRing(ring: number[][]) {
    if (ring.length === 0) {
        return {vertices: [], indices: []};
    }
    const vertices: number[] = [];
    for (let i = 0; i < ring.length; ++i) {
        const p = ring[i];
        vertices.push(p[0], p[1]);
    }
    const indices = earcut(vertices);
    return {vertices, indices};
}


export function triangulatePolygonWithHoles(polygon: number[][][]): {
    vertices: number[],
    indices: number[]
} {
    const vertices: number[] = [];
    const holes: number[] = [];
    polygon.forEach((ring, ringIndex) => {
        if (ringIndex > 0) {
            holes.push(vertices.length / 2);
        }
        ring.forEach(([x, y]) => {
            vertices.push(x, y);
        });
    });
    const indices = earcut(vertices, holes.length > 0 ? holes : undefined, 2);
    return {vertices, indices};
}