// Async GET request with custom headers
export async function requestAsync(url: string): Promise<any> {
    try {
        const response = await fetch(url, {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
            return await response.json();
        } else if (contentType?.includes('text')) {
            return await response.text();
        } else {
            return await response.arrayBuffer();
        }
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}

export function buildURL(z: number,
                         x: number,
                         y: number,
                         url: string
): string {
    return url.replace("{z}", z.toString())
        .replace("{x}", x.toString())
        .replace("{y}", y.toString())
    // .replace("{key}", key);
};

export async function requestVectorTile(z: number,
                                        x: number,
                                        y: number,
                                        url: string): Promise<ArrayBuffer> {
    const replaceUrl: string = buildURL(z, x, y, url);
    return requestAsync(replaceUrl) as Promise<ArrayBuffer>;
}

// Parse vector tile data

