import { type CustomSource, type DataTileState } from './SourceInterface'
import { LRUCache } from 'lru-cache';
import maplibregl, { OverscaledTileID, } from 'maplibre-gl';
import * as THREE from 'three'
import { BatchedModelFetcher } from './BatchedModelFetcher'
export type BatchedModelSourceOpts = {
    id: string,
    url: string,
    minZoom: number,
    maxZoom: number,
    tileSize: number,
    maxTileCache: number;
    map: maplibregl.Map;
}

type BatchedModelTileData = {
    data : THREE.Object3D | null; 
    state : DataTileState;
}

export class BatchedModelSource implements CustomSource {
    id: string;
    url: string;
    readonly type = 'batched_model' as const;
    minZoom: number; 
    maxZoom: number; 
    tileSize: number = 512; 
    map : maplibregl.Map | null = null; 
    private tileCache : LRUCache<string,BatchedModelTileData>;
    private modelFetcher: BatchedModelFetcher = new BatchedModelFetcher(6);
    private onUnloadTile: Array<(tile_key: string) => void> = [];
    private failedTiles: Map<string, number> = new Map(); // tile_key -> retry after timestamp
    private readonly RETRY_TIMEOUT = 30_000; // 30s cooldown for failed tiles
    constructor(opts : BatchedModelSourceOpts){
        this.map = opts.map;
        this.id = opts.id; 
        this.minZoom = opts.minZoom; 
        this.maxZoom = opts.maxZoom; 
        this.tileSize = opts.tileSize; 
        this.url = opts.url; 
        this.tileCache = new LRUCache<string, BatchedModelTileData>({
                    max: opts.maxTileCache ?? 1024,
                    dispose: (tile,tile_key) => {
                        if (tile?.state === 'preparing') {
                            tile.state = 'disposed';
                        }
                        this.unloadTile(tile_key);
                    },
        }); 
    }

    private unloadTile(tile_key : string) {
        this.onUnloadTile.forEach((func) => {
            if (func) {
                func(tile_key);
            }
        });
    }

    private tileKey(tile: OverscaledTileID): string {
        const c = tile.canonical;
        return `${c.z}/${c.x}/${c.y}`;
    }

        /** Delete a specific tile from cache so it will be re-fetched on next access */
    deleteTile(tileKey: string): void {
        this.tileCache.delete(tileKey);
    }
    
    /** Clear all tile cache, forcing a full reload */
    clearCache(): void {
        this.tileCache.clear();
        this.map?.triggerRepaint();
    }

    registerUnLoadTile(func: (tile_key: string) => void) {
        if (func) {
            this.onUnloadTile.push(func);
        }
    }

    getTile(tile: OverscaledTileID): BatchedModelTileData {
            const string_key = this.tileKey(tile);
            let tileData = this.tileCache.get(string_key);
            if (!tileData) {
                const canonicalId = tile.canonical;
                tileData = {
                    state: 'preparing',
                    data: null
                };
                this.tileCache.set(string_key, tileData);
                this.modelFetcher.fetch(this.url, canonicalId.z, canonicalId.x, canonicalId.y, modelData => {
                    const cached = this.tileCache.get(string_key);
                    if (cached && cached.state !== 'disposed') {
                        cached.data = modelData.object3d ?? null;
                        cached.state = 'loaded';
                        this.map?.triggerRepaint();
                    }
                }, (tileUrl) => {
                    const cached = this.tileCache.get(string_key);
                    if (cached && cached.state !== 'disposed') {
                        cached.state = 'error';
                    }
                    console.warn(`[BatchedModelSource] tile không tồn tại: ${tileUrl}`);
                });
            }
            return tileData;
        }
}
