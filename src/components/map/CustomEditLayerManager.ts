import type {Custom3DTileRenderLayer, PickHit} from "./Interface.ts";
export class CustomEditLayerManager {
    layer_cache: Map<string, Custom3DTileRenderLayer> = new Map<string, Custom3DTileRenderLayer>();
    current_layer: Custom3DTileRenderLayer | null = null;
    constructor() {
    }
    addNewLayer(id : string,layer : Custom3DTileRenderLayer){
        if(!this.layer_cache.has(id)){
            this.layer_cache.set(id,layer);
        }
    }
    removeLayer(id : string){
        if(this.layer_cache.has(id)){
            this.layer_cache.delete(id);
        }
    }
    setCurrentLayer(id : string) {
        this.current_layer = null;
        this.current_layer = this.layer_cache.get(id) ?? null;
    }
    setPickHandler(cb: (info: PickHit) => void) {
        if (!this.current_layer) return;
        this.current_layer.onPick = cb;
    }
    setPickFailHandler(cb: () => void) {
        if (!this.current_layer) return;
        this.current_layer.onPickfail = cb;
    }
}