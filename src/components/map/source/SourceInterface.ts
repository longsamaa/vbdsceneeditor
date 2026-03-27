import type {OverscaledTileID} from 'maplibre-gl';
import type {JsonVectorTile} from './GeojsonConverter.ts';

export type DataTileState = 'preparing' | 'loaded' | 'error' | 'disposed';

export type VectorTileData = {
    data: JsonVectorTile | null;
    state: DataTileState;
};

/** Base interface cho mọi custom source */
export interface CustomSource {
    readonly id: string;
    readonly type: string;
    registerUnLoadTile(func: (tile_key: string) => void): void;
    deleteTile(tileKey: string): void;
    clearCache(): void;
}

/**
 * Interface chung cho source trả về vector tile data (JsonVectorTile).
 * Cả CustomVectorSource và CustomGeoJsonSource đều implement interface này,
 * cho phép layer dùng chung mà không cần biết nguồn data.
 */
export interface VectorSourceLike extends CustomSource {
    minZoom: number;
    maxZoom: number;
    getTile(tile: OverscaledTileID, opts?: { build_triangle: boolean }): VectorTileData;
}

/** Source lấy data từ tile server qua URL template {z}/{x}/{y} */
export interface TileSource extends CustomSource {
    url: string;
    minZoom: number;
    maxZoom: number;
    tileSize: number;
}
