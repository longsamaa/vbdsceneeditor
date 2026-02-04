export class TileFetcher {
    private active = 0;
    private queue: (() => void)[] = [];
    private MAX = 6;
    constructor(max : number) {
        this.MAX = max;
    }
    private buildTileUrl(url : string, z: number, x: number, y: number): string {
        // thay token chuẩn {z}/{x}/{y}
        let replace_url = url
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
        replace_url = replace_url.replace('{ratio}', '1').replace('{r}', '');
        return replace_url;
    }
    fetch(url : string,z : number, x : number , y : number, cb: (buf: ArrayBuffer) => void) {
        this.queue.push(() => {
            const replace_url = this.buildTileUrl(url,z,x,y);
            this.active++;
            fetch(replace_url)
                .then(r => r.arrayBuffer())
                .then(cb)
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
