import maplibregl, {MapMouseEvent,} from 'maplibre-gl';
import {reverseFaceWinding} from '../model/objModel.ts';
import {classifyRings} from '@mapbox/vector-tile';
import {clampZoom, latlonToLocal} from '../convert/map_convert.ts';
import type {Custom3DTileRenderLayer, PickHit, SunOptions, SunParamater, PrerenderGeometryLayer} from '../Interface.ts'
import * as THREE from 'three';
import {CustomVectorSource} from "../source/CustomVectorSource.ts"
import {buildGeo, triangulatePolygonWithHoles} from "../source/GeojsonConverter.ts";
import type {Feature, GeoJsonProperties, MultiPolygon, Polygon, Position} from 'geojson';
import {createWaterMaterial,WaterReflectionMaterial} from "./WaterMaterial.ts";
import * as turf from "@turf/turf";
import {calculateSunDirectionMaplibre} from "../shadow/ShadowHelper.ts";
import {getSharedRenderer} from "../SharedRenderer.ts";
import { getSharedReflectionPass, ReflectionPass } from '../water/ReflectionPass.ts';

export type WaterLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    sourceLayer: string,
    normalUrl: string,
    sun?: SunOptions;
    minZoom?: number,
    maxZoom?: number,
}

export class WaterLayer implements Custom3DTileRenderLayer, PrerenderGeometryLayer {
    id: string;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    sourceLayer: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    //waterMaterial: THREE.ShaderMaterial | null = null;
    waterMaterial : WaterReflectionMaterial | null = null; 
    private vectorSource: CustomVectorSource | null = null;
    private mainScene: THREE.Scene | null = null;
    private sun: SunParamater | null | undefined;
    private tilekeyToDrawWater: string = '';
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private applyGlobeMatrix: boolean | false = false;
    private waterNormalTexture: THREE.Texture | null = null;
    private waterGeometry: Feature<Polygon | MultiPolygon, GeoJsonProperties> | null = null;
    private isRebuildWaterGeometry: boolean = true;
    private minZoom: number = 0;
    private maxZoom: number = 20;
    private readonly TILE_EXTENT = 8192;
    private _projMatrix = new THREE.Matrix4();
    private _visibleTiles: any[] = [];
    private _zoom: number = 0;
    private reflectionPass : ReflectionPass | null = null;
    private _registeredPrerender: boolean = false;
    private _sunDir = new THREE.Vector3(0.5, 1.0, 0.5).normalize();

    constructor(opts: WaterLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
        this.sourceLayer = opts.sourceLayer;
        this.waterNormalTexture = new THREE.TextureLoader().load(
            opts.normalUrl,
            (t) => {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
            }
        );
        this.waterMaterial = new WaterReflectionMaterial(null, this.waterNormalTexture);
        if (opts.sun) {
            this.setSun(opts.sun);
        }
        this.waterMaterial.opacity = 1.0; 
        this.minZoom = opts.minZoom ?? 16;
        this.maxZoom = opts.maxZoom ?? 20;
    }

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = getSharedRenderer(map.getCanvas(), gl);
        this.mainScene = new THREE.Scene();
        this.map.on('moveend', () => {
            this.isRebuildWaterGeometry = true;
        })
        map.on('click', this.handleClick);
        this.isRebuildWaterGeometry = true;
        const canvas = this.map.getCanvas(); 
        if(!this.reflectionPass){
            this.reflectionPass = getSharedReflectionPass(canvas.width * 0.5, canvas.height * 0.5); 
        }
    }

    onRemove(): void {
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    setVectorSource(source: CustomVectorSource): void {
        this.vectorSource = source;
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    private handleClick = (e: MapMouseEvent) => {
        if(!this.reflectionPass || !this.renderer || !this.map) return;
        const center = this.map.getCenter();
        console.log('Water click:', {
            pitch: this.map.getPitch(),
            bearing: this.map.getBearing(),
            zoom: this.map.getZoom(),
            center: { lat: center.lat, lng: center.lng },
        });
    };

    prerender(): void {
        if (this._registeredPrerender) return;
        this._doPrerenderGeometry();
    }

    private _doPrerenderGeometry(): void {
        if (!this.map || !this.vectorSource || !this.isRebuildWaterGeometry) {
            return;
        }
        if (this.map.getZoom() <= this.minZoom) return;
        this._zoom = clampZoom(
            this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom())
        );

        this._visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: this._zoom,
            maxzoom: this._zoom,
            roundZoom: true,
        });

        // Cache tiles and check readiness
        let dataNotReady : boolean = false;
        const tileDataMap = new Map();
        for (const tile of this._visibleTiles) {
            const vectorTile = this.vectorSource.getTile(tile, {
                build_triangle: true,
            });

            if (vectorTile?.state !== 'loaded') {
                if(!dataNotReady){
                    dataNotReady = true;
                }
            }
            tileDataMap.set(tile, vectorTile);
        }

        if(dataNotReady) {
            return;
        }
        const center = this.map.getCenter();
        const rootTile = latlonToLocal(center.lng, center.lat, this._zoom);
        this.tilekeyToDrawWater = this.tileKey(rootTile.tileX, rootTile.tileY, this._zoom);
        const polygonToMerge: Feature<Polygon>[] = [];
        for (const [tile, vectorTileData] of tileDataMap) {
            const layer = vectorTileData.data?.layers?.[this.sourceLayer];
            if (!layer) continue;
            const offsetX = (tile.canonical.x - rootTile.tileX) * this.TILE_EXTENT;
            const offsetY = (tile.canonical.y - rootTile.tileY) * this.TILE_EXTENT;
            for (const feature of layer.features) {
                if (feature.type !== 'Polygon') continue;
                const geom = feature.geometry;
                const polygons = classifyRings(geom);
                for (const polygon of polygons) {
                    const transformedRings = polygon.map(ring =>
                        ring.map(p => [p.x + offsetX, p.y + offsetY])
                    );
                    const closedRings = transformedRings.map(ring => {
                        const first = ring[0];
                        const last = ring[ring.length - 1];
                        if (first[0] !== last[0] || first[1] !== last[1]) {
                            return [...ring, [first[0], first[1]]];
                        }
                        return ring;
                    });
                    polygonToMerge.push(turf.polygon(closedRings));
                }
            }
        }

        if(polygonToMerge.length === 0){
            this.waterGeometry = null;
            this.isRebuildWaterGeometry = false;
            return;
        }

        try {
            if (polygonToMerge.length == 1) {
                this.waterGeometry = polygonToMerge[0];
            } else {
                this.waterGeometry = turf.union(turf.featureCollection(polygonToMerge));
            }
            this.mainScene?.clear();
            //build geo
            const geometry = this.waterGeometry?.geometry;
            const buildGeoFromPolygon = (polygon: Position[][]) => {
                const {vertices, indices} = triangulatePolygonWithHoles(polygon);
                const geo = buildGeo(vertices, indices);
                reverseFaceWinding(geo);
                if (this.waterMaterial) {
                    const waterMesh = new THREE.Mesh(geo, this.waterMaterial);
                    this.mainScene?.add(waterMesh);
                }
            }
            if (geometry) {
                if (geometry.type === 'MultiPolygon') {
                    const polygonCoords = geometry.coordinates;
                    for (const polygon of polygonCoords) {
                        buildGeoFromPolygon(polygon);
                    }
                } else {
                    if (geometry.type === 'Polygon') {
                        const polygon = geometry.coordinates;
                        buildGeoFromPolygon(polygon);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to merge water polygons:', error);
        } finally {
            this.isRebuildWaterGeometry = false;
        }
    }

    setRegisteredPrerender(value: boolean): void {
        this._registeredPrerender = value;
    }

    prerenderGeometry(): void {
        this._doPrerenderGeometry();
    }

    hasGeometry(): boolean {
        return this.waterGeometry !== null;
    }

    setSun(sun: SunOptions): void {
        this.sun = {
            altitude: sun.altitude,
            azimuth: sun.azimuth,
            sun_dir: new THREE.Vector3(),
            shadow: sun.shadow,
            lat: sun.lat,
            lon: sun.lon,
        };
        calculateSunDirectionMaplibre(
            THREE.MathUtils.degToRad(sun.altitude),
            THREE.MathUtils.degToRad(sun.azimuth),
            this._sunDir,
        );
        if (this.waterMaterial) {
            this.waterMaterial.setLightDir(this._sunDir);
        }
    }

    animate() {
        if (!this.waterMaterial || !this.reflectionPass) {
            return;
        }
        this.waterMaterial.updateReflectionTexture(this.reflectionPass.getRenderTarget().getTexture());
        if (this.waterNormalTexture) {
            this.waterMaterial.updateNormalMap(this.waterNormalTexture);
        }
        this.waterMaterial.setTime(this.waterMaterial.uniforms.time.value + 0.016);
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.mainScene ) {
            return;
        }
        const tr = this.map.transform;
        if(tr.zoom <= this.minZoom) return; 
        for (const tile of this._visibleTiles) {
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (tile_key === this.tilekeyToDrawWater) {
                const projectionData = tr.getProjectionData({
                    overscaledTileID: tile,
                    applyGlobeMatrix: this.applyGlobeMatrix,
                });
                this.camera.projectionMatrix = this._projMatrix.fromArray(projectionData.mainMatrix);
                this.animate();
                this.renderer.resetState();
                this.renderer.render(this.mainScene, this.camera);
                this.map.triggerRepaint();
                break;
            }
        }
    }

    getShadowParam() {
        return undefined;
    }

    setLayerSourceCastShadow(source: Custom3DTileRenderLayer): void {
        this.layerSourceCastShadow = source;
    }
}