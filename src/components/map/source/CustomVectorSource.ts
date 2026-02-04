import {type CustomSource} from './SourceInterface'
import {LRUCache} from 'lru-cache';
import {TileFetcher} from './TileFetcher'
import type {WorkerOutput} from './Worker.ts'
import type {JsonVectorTile} from './GeojsonConverter.ts'
type CustomVectorTileState = 'preparing' | 'loaded' | 'error' | 'disposed';
type CustomVectorTileData = {
    data: JsonVectorTile | null;
    state: CustomVectorTileState;
}
import maplibregl, {
    OverscaledTileID,
} from 'maplibre-gl';

export type CustomVectorSourceOpts = {
    id: string,
    url: string,
    minZoom: number;
    maxZoom: number;
    tileSize: number;
    maxTileCache: number;
    map: maplibregl.Map;
}

export type GetTileOptions = {
    build_triangle : boolean,
}

export class CustomVectorSource implements CustomSource {
    id: string;
    url: string;
    readonly type = 'custom' as const;
    minZoom: number;
    maxZoom: number;
    tileSize: number = 512;
    map: maplibregl.Map | null = null;
    tileFetcher: TileFetcher = new TileFetcher(8);
    onUnloadTile : (tile_key : string) => void;
    private worker: Worker | null = null;
    private tileCache: LRUCache<string, CustomVectorTileData>;
    constructor(opts: CustomVectorSourceOpts) {
        this.map = opts.map;
        this.id = opts.id;
        this.url = opts.url;
        this.minZoom = opts.minZoom;
        this.maxZoom = opts.maxZoom;
        this.tileSize = opts.tileSize;
        this.tileCache = new LRUCache<string, CustomVectorTileData>({
            max: opts.maxTileCache ?? 1024,
            dispose: (tile,tile_key) => {
                if (tile?.state === 'preparing') {
                    tile.state = 'disposed';
                }
                this.unloadTile(tile_key);
            },
        });
        this.setupWorkerListeners();
    }
    private setupWorkerListeners() : void {
       this.worker = new Worker(new URL('./Worker.ts', import.meta.url), {type: 'module'})
        this.worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
           const {result,tile_key} = e.data;
           const tile = this.tileCache.get(tile_key);
            if (tile) {
                tile.data = result;
                tile.state = 'loaded';
                this.map?.triggerRepaint();
            }
        };
    }
    private tileKey(tile: OverscaledTileID): string {
        const c = tile.canonical;
        return `${c.z}/${c.x}/${c.y}`;
    }
    private unloadTile(tile_key : string) {
        this.onUnloadTile?.(tile_key);
    }
    getTile(tile: OverscaledTileID, opts : GetTileOptions): CustomVectorTileData {
        const string_key = this.tileKey(tile);
        let tileData = this.tileCache.get(string_key);
        if (!tileData) {
            const canonicalId = tile.canonical;
            this.tileFetcher.fetch(this.url, canonicalId.z, canonicalId.x, canonicalId.y, buf => {
                this.worker?.postMessage({
                    tile_key : string_key,
                    buffer: buf,
                    opts : opts}, [buf]);
            });
            tileData = {
                state: 'preparing',
                data: null
            };
            this.tileCache.set(string_key, tileData);
        }
        return tileData;
    }
}