import maplibregl, {type CustomRenderMethodInput, OverscaledTileID} from 'maplibre-gl';
import * as THREE from 'three';
import {GroundShadowMaterial} from '../shadow/ShadowLitMaterial.ts';
import {getSharedShadowPass, ShadowMapPass} from '../shadow/ShadowMapPass.ts';
import {getSharedRenderer} from '../SharedRenderer.ts';
import {tileLocalToLatLon, projectToWorldCoordinates} from '../convert/map_convert.ts';
import {reverseFaceWinding} from '../model/objModel.ts';
import {createMapLibreMatrix, calculateTileMatrixThree} from '../shadow/ShadowCamera.ts';
import type {Custom3DTileRenderLayer, ShadowCasterLayer} from '../Interface.ts';

export type GroundLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    minZoom: number;
    maxZoom: number;
    elevationOffset?: number;
};

type GroundTileCache = {
    sceneTile: THREE.Scene;
    groundShadowMat: GroundShadowMaterial;
};

export class GroundLayer implements Custom3DTileRenderLayer, ShadowCasterLayer {
    id: string;
    visible = true;
    pickEnabled = false;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize = 512;
    useOrchestrator = false;

    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private shadowMapPass: ShadowMapPass | null = null;
    private tileCache: Map<string, GroundTileCache> = new Map();
    private _visibleTiles: OverscaledTileID[] = [];
    private minZoom: number;
    private maxZoom: number;
    private elevationOffset: number;
    private _viewProjMatrix: THREE.Matrix4 = new THREE.Matrix4();

    constructor(opts: GroundLayerOpts) {
        this.id = opts.id;
        this.minZoom = opts.minZoom;
        this.maxZoom = opts.maxZoom;
        this.elevationOffset = opts.elevationOffset ?? 1.0;
    }

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        if (!this.shadowMapPass) {
            this.shadowMapPass = getSharedShadowPass(8192);
        }
    }

    onRemove(): void {
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
    }

    clearCache(): void {
        this.tileCache.clear();
        this.shadowMapPass?.lightMatrices.clear();
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    prerender(): void {
        if (!this.map) return;
        const zoom = Math.round(this.map.getZoom());
        if (zoom < this.minZoom) return;
        const tr = this.map.transform as any;
        const point = projectToWorldCoordinates(tr.worldSize, {
            lat: tr.center.lat,
            lon: tr.center.lng,
        });
        this._viewProjMatrix = createMapLibreMatrix(
            tr.fovInRadians,
            tr.width,
            tr.height,
            tr.nearZ,
            tr.farZ * 2.0,
            tr.cameraToCenterDistance,
            tr.rollInRadians,
            tr.pitchInRadians,
            tr.bearingInRadians,
            point.x,
            point.y,
            tr.pixelsPerMeter,
            tr.elevation,
        );
        const clampedZoom = Math.min(zoom, this.maxZoom);
        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: clampedZoom,
            maxzoom: clampedZoom,
            roundZoom: true,
        });

        const hasTerrain = !!this.map.getTerrain();
        for (const tile of this._visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (this.tileCache.has(key)) continue;
            const scene = new THREE.Scene();
            const groundMat = new GroundShadowMaterial();
            const mesh = this.buildTerrainPlane(tile, hasTerrain);
            mesh.material = groundMat;
            scene.add(mesh);
            this.tileCache.set(key, {sceneTile: scene, groundShadowMat: groundMat});
        }
    }

    private buildTerrainPlane(tile: OverscaledTileID, hasTerrain: boolean): THREE.Mesh {
        const EXTENT = 8192;
        const segments = 8;
        const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, segments, segments);
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
        const z = tile.canonical.z;
        const tileX = tile.canonical.x;
        const tileY = tile.canonical.y;

        for (let i = 0; i < posAttr.count; i++) {
            const px = posAttr.getX(i) + EXTENT / 2;
            const py = posAttr.getY(i) + EXTENT / 2;
            let elev = 0;
            if (hasTerrain && this.map) {
                const latLon = tileLocalToLatLon(z, tileX, tileY, px, py);
                const terrainElev = this.map.queryTerrainElevation([latLon.lon, latLon.lat]);
                if (terrainElev !== null) {
                    elev = terrainElev;
                }
            }
            posAttr.setX(i, px);
            posAttr.setY(i, py);
            posAttr.setZ(i, elev);
        }
        posAttr.needsUpdate = true;
        geo.computeVertexNormals();
        //reverseFaceWinding(geo);

        const mesh = new THREE.Mesh(geo);
        mesh.name = 'ground_shadow_plane';
        return mesh;
    }

    renderShadowDepth(_renderer: THREE.WebGLRenderer, worldSize: number): void {
        if (!this.shadowMapPass) return;
        this.shadowMapPass.shadowPassNoClear(
            _renderer,
            this._visibleTiles,
            worldSize,
            (tile) => this.tileKey(tile.canonical.x,tile.canonical.y,tile.canonical.z),
            (key) => this.tileCache.get(key)?.sceneTile,
        );
        // this.shadowMapPass.computeLightMatrices(
        //     this._visibleTiles,
        //     worldSize,
        //     (tile) => this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z),
        // );
    }

    shadowPass(): void {}

    mainPass(tr: any, visibleTiles: OverscaledTileID[]): void {
        if (!this.renderer || !this.camera || !this.shadowMapPass) return;
        this.renderer.resetState();
        this.renderer.clearStencil(); 
        for (const tile of visibleTiles) {
            const key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            const tileInfo = this.tileCache.get(key);
            if (!tileInfo) continue;
            const tileMatrix = calculateTileMatrixThree(tile.toUnwrapped(), tr.worldSize);
            this.camera.projectionMatrix = new THREE.Matrix4().multiplyMatrices(this._viewProjMatrix, tileMatrix);
            const lightMatrix = this.shadowMapPass.lightMatrices.get(key);
            const shadowMap = this.shadowMapPass.getRenderTarget();
            tileInfo.groundShadowMat.update(lightMatrix, shadowMap);
            this.renderer.render(tileInfo.sceneTile, this.camera);
        }
    }

    render(_gl: WebGLRenderingContext, _args: CustomRenderMethodInput): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible) return;
        if (this.map.getZoom() < this.minZoom) return;
        const tr = this.map.transform;
        this.mainPass(tr, this._visibleTiles);
    }

    getShadowParam() {
        return undefined;
    }

    getShadowMapPass(): ShadowMapPass | null {
        if (!this.shadowMapPass) {
            this.shadowMapPass = getSharedShadowPass(8192);
        }
        return this.shadowMapPass;
    }

    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void {
        this.layerSourceCastShadow = source;
    }
}
