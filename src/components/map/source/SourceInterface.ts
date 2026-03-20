export interface CustomSource {
    type: string;
    id : string;
    url : string;
    minZoom: number;
    maxZoom: number;
    tileSize: number;
}
export type DataTileState = 'preparing' | 'loaded' | 'error' | 'disposed';
