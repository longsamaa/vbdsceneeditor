import { loadModelFromGlb } from '../model/objModel';
import type { ModelData } from '../Interface';

export class BatchedModelFetcher {
    private active = 0;
    private queue: (() => void)[] = [];
    private MAX = 6;
    private failedUrls = new Set<string>();
    constructor(max: number) {
        this.MAX = max;
    }
    private buildTileUrl(url: string, z: number, x: number, y: number): string {
        let replace_url = url
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
        replace_url = replace_url.replace('{ratio}', '1').replace('{r}', '');
        return replace_url;
    }
    fetch(url: string, z: number, x: number, y: number, cb: (model: ModelData) => void, onError?: (tileUrl: string) => void) {
        const replace_url = this.buildTileUrl(url, z, x, y);
        if (this.failedUrls.has(replace_url)) return;
        this.queue.push(() => {
            this.active++;
            loadModelFromGlb(replace_url)
                .then(cb)
                .catch(() => {
                    this.failedUrls.add(replace_url);
                    onError?.(replace_url);
                })
                .finally(() => {
                    this.active--;
                    this.run();
                });
        });
        this.run();
    }
    private run() {
        if (this.active >= this.MAX) return;
        const job = this.queue.shift();
        job?.();
    }
}
