// worker.ts
import Protobuf from 'pbf';
import {type JsonVectorTile, vectorTileToJSON} from "./GeojsonConverter.ts";
import {VectorTile} from "@mapbox/vector-tile";
import type {GetTileOptions} from "./CustomVectorSource.ts";
export {};
export type WorkerInput = {
    buffer: ArrayBuffer,
    tile_key : string,
    opts : GetTileOptions,
}
export type WorkerOutput = {
    tile_key : string,
    result: JsonVectorTile;
    indices : number[][];
};
self.onmessage = (event: MessageEvent<WorkerInput>) => {
    const buffer = event.data.buffer;
    const tile_key = event.data.tile_key;
    const pbf = new Protobuf(buffer);
    const vectorTile = new VectorTile(pbf);
    const indices : number[][] = [];
    const output: WorkerOutput = {
        tile_key : tile_key,
        result: vectorTileToJSON(vectorTile),
        indices : indices,
    };
    self.postMessage(output);
};

