import geojsonvt from 'geojson-vt';
import Point from '@mapbox/point-geometry';
import {LRUCache} from 'lru-cache';
import maplibregl, {OverscaledTileID} from 'maplibre-gl';
import type {VectorSourceLike, VectorTileData} from './SourceInterface.ts';
import type {JsonVectorTile, JsonVectorTileFeature} from './GeojsonConverter.ts';

export type GeoJsonFeature = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

export type CustomGeoJsonSourceOpts = {
    id: string;
    map: maplibregl.Map;
    /** Tên layer khi convert sang JsonVectorTile (default: 'default') */
    layerName?: string;
    minZoom?: number;
    maxZoom?: number;
    maxTileCache?: number;
    /** geojson-vt options */
    tolerance?: number;
    extent?: number;
    buffer?: number;
    generateId?: boolean;
    promoteId?: string;
};

const VT_TYPE_MAP: Record<number, 'Point' | 'LineString' | 'Polygon'> = {
    1: 'Point',
    2: 'LineString',
    3: 'Polygon',
};

export class CustomGeoJsonSource implements VectorSourceLike {
    readonly id: string;
    readonly type = 'custom_geojson' as const;
    minZoom: number;
    maxZoom: number;
    map: maplibregl.Map | null = null;

    private readonly layerName: string;
    private readonly extent: number;
    private tileIndex: ReturnType<typeof geojsonvt> | null = null;
    private tileCache: LRUCache<string, VectorTileData>;
    private onUnloadTile: Array<(tile_key: string) => void> = [];
    private vtOptions: geojsonvt.Options;

    private featureCollection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [],
    };

    constructor(opts: CustomGeoJsonSourceOpts) {
        this.id = opts.id;
        this.map = opts.map;
        this.layerName = opts.layerName ?? 'default';
        this.minZoom = opts.minZoom ?? 0;
        this.maxZoom = opts.maxZoom ?? 18;
        this.extent = opts.extent ?? 8192;
        this.vtOptions = {
            maxZoom: this.maxZoom,
            tolerance: opts.tolerance ?? 3,
            extent: this.extent,
            buffer: opts.buffer ?? 64,
            generateId: opts.generateId ?? false,
            promoteId: opts.promoteId,
        };
        this.tileCache = new LRUCache<string, VectorTileData>({
            max: opts.maxTileCache ?? 512,
            dispose: (_tile, tile_key) => {
                this.unloadTile(tile_key);
            },
        });
    }

    // ─── Data management ─────────────────────────────────────

    setData(data: GeoJSON.FeatureCollection): void {
        this.featureCollection = data;
        this.rebuildIndex();
    }

    addFeature(feature: GeoJsonFeature): void {
        this.featureCollection.features.push(feature);
        this.rebuildIndex();
    }

    addFeatures(features: GeoJsonFeature[]): void {
        this.featureCollection.features.push(...features);
        this.rebuildIndex();
    }

    removeFeature(id: string | number): boolean {
        const before = this.featureCollection.features.length;
        this.featureCollection.features = this.featureCollection.features.filter(
            f => (f.id ?? f.properties?.id) !== id
        );
        if (this.featureCollection.features.length !== before) {
            this.rebuildIndex();
            return true;
        }
        return false;
    }

    updateFeature(id: string | number, props: Record<string, unknown>): void {
        const f = this.featureCollection.features.find(
            f => (f.id ?? f.properties?.id) === id
        );
        if (f) {
            f.properties = {...f.properties, ...props};
            this.rebuildIndex();
        }
    }

    clear(): void {
        this.featureCollection = {type: 'FeatureCollection', features: []};
        this.tileIndex = null;
        this.tileCache.clear();
        this.map?.triggerRepaint();
    }

    getData(): GeoJSON.FeatureCollection {
        return this.featureCollection;
    }

    // ─── VectorSourceLike interface ──────────────────────────

    getTile(tile: OverscaledTileID): VectorTileData {
        const c = tile.canonical;
        const key = `${c.z}/${c.x}/${c.y}`;
        const cached = this.tileCache.get(key);
        if (cached) return cached;

        if (!this.tileIndex) {
            return {data: null, state: 'loaded'};
        }

        const vtTile = this.tileIndex.getTile(c.z, c.x, c.y);
        const jsonTile = this.convertToJsonVectorTile(vtTile);
        const tileData: VectorTileData = {
            data: jsonTile,
            state: 'loaded',
        };
        this.tileCache.set(key, tileData);
        return tileData;
    }

    registerUnLoadTile(func: (tile_key: string) => void): void {
        if (func) {
            this.onUnloadTile.push(func);
        }
    }

    deleteTile(tileKey: string): void {
        this.tileCache.delete(tileKey);
    }

    clearCache(): void {
        this.tileCache.clear();
        this.map?.triggerRepaint();
    }

    // ─── Internal ────────────────────────────────────────────

    private rebuildIndex(): void {
        this.tileIndex = geojsonvt(this.featureCollection, this.vtOptions);
        this.tileCache.clear();
        this.map?.triggerRepaint();
    }

    private unloadTile(tile_key: string): void {
        for (const func of this.onUnloadTile) {
            func(tile_key);
        }
    }

    /** Convert geojson-vt Tile → JsonVectorTile (cùng format với CustomVectorSource) */
    private convertToJsonVectorTile(vtTile: geojsonvt.Tile | null): JsonVectorTile | null {
        if (!vtTile || vtTile.features.length === 0) return null;

        const features: JsonVectorTileFeature[] = [];
        for (const f of vtTile.features) {
            const typeName = VT_TYPE_MAP[f.type];
            if (!typeName) continue;

            let geometry: Point[][];
            if (f.type === 1) {
                // Point: geometry là flat [x,y, x,y, ...] → wrap thành [[Point, ...]]
                const ring: Point[] = [];
                for (let i = 0; i < f.geometry.length; i++) {
                    const [x, y] = f.geometry[i] as [number, number];
                    ring.push(new Point(x, y));
                }
                geometry = [ring];
            } else {
                // Line/Polygon: geometry là [[x,y],[x,y],...] per ring
                geometry = (f.geometry as unknown as [number, number][][]).map(ring =>
                    ring.map(([x, y]) => new Point(x, y))
                );
            }

            features.push({
                id: f.id != null ? Number(f.id) : undefined,
                type: typeName,
                geometry,
                properties: (f.tags ?? {}) as Record<string, number | string | boolean>,
            });
        }

        return {
            layers: {
                [this.layerName]: {
                    name: this.layerName,
                    extent: this.extent,
                    features,
                },
            },
        };
    }
}
