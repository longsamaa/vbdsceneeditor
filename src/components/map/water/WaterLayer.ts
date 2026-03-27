import maplibregl, {MapMouseEvent,} from 'maplibre-gl';
import {reverseFaceWinding} from '../model/objModel.ts';
import {classifyRings} from '@mapbox/vector-tile';
import {clampZoom, latlonToLocal, tileLocalToLatLon, projectToWorldCoordinates} from '../convert/map_convert.ts';
import type {Custom3DTileRenderLayer, PickHit, SunOptions, SunParamater, PrerenderGeometryLayer} from '../Interface.ts'
import * as THREE from 'three';
import type {VectorSourceLike} from "../source/SourceInterface.ts"
import {buildGeo, triangulatePolygonWithHoles} from "../source/GeojsonConverter.ts";
import type {Feature, GeoJsonProperties, MultiPolygon, Polygon, Position} from 'geojson';
import {WaterReflectionMaterial, type WaterSettings} from "./WaterMaterial.ts";
import * as turf from "@turf/turf";
import {calculateSunDirectionMaplibre} from "../shadow/ShadowHelper.ts";
import {getSharedRenderer} from "../SharedRenderer.ts";
import { getSharedReflectionPass, ReflectionPass } from '../water/ReflectionPass.ts';
import {createMapLibreMatrix, calculateTileMatrixThree} from '../shadow/ShadowCamera.ts';

export type WaterLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    sourceLayer: string,
    normalUrl?: string,
    sun?: SunOptions;
    minZoom?: number,
    maxZoom?: number,
    settings?: Partial<WaterSettings>,
}

export class WaterLayer implements Custom3DTileRenderLayer, PrerenderGeometryLayer {
    id: string;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    pickEnabled: boolean = true;
    layerSourceCastShadow: Custom3DTileRenderLayer | null = null;
    sourceLayer: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    //waterMaterial: THREE.ShaderMaterial | null = null;
    waterMaterial : WaterReflectionMaterial | null = null; 
    private vectorSource: VectorSourceLike | null = null;
    private mainScene: THREE.Scene | null = null;
    private sun: SunParamater | null | undefined;
    private tilekeyToDrawWater: string = '';
    private map: maplibregl.Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.Camera | null = null;
    private waterNormalTexture: THREE.Texture | null = null;
    private waterGeometry: Feature<Polygon | MultiPolygon, GeoJsonProperties> | null = null;
    private isRebuildWaterGeometry: boolean = true;
    private minZoom: number = 0;
    private maxZoom: number = 20;
    private readonly TILE_EXTENT = 8192;
    private _viewProjMatrix: THREE.Matrix4 = new THREE.Matrix4();
    private _visibleTiles: any[] = [];
    private _zoom: number = 0;
    private reflectionPass : ReflectionPass | null = null;
    private _registeredPrerender: boolean = false;
    private _sunDir = new THREE.Vector3(0.5, 1.0, 0.5).normalize();

    constructor(opts: WaterLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
        this.sourceLayer = opts.sourceLayer;
        if (opts.normalUrl) {
            this.waterNormalTexture = new THREE.TextureLoader().load(
                opts.normalUrl,
                (t) => {
                    t.wrapS = t.wrapT = THREE.RepeatWrapping;
                }
            );
        }
        this.waterMaterial = new WaterReflectionMaterial(null, this.waterNormalTexture);
        if (opts.sun) {
            this.setSun(opts.sun);
        }
        if (opts.settings) {
            this.waterMaterial.applySettings(opts.settings);
        }
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

    setVisible(visible: boolean): void {
        this.visible = visible;
    }

    setSource(source: VectorSourceLike): void {
        this.vectorSource = source;
    }

    private tileKey(x: number, y: number, z: number): string {
        return `${z}/${x}/${y}`;
    }

    setPickEnabled(enabled: boolean): void {
        this.pickEnabled = enabled;
    }

    private handleClick = (_e: MapMouseEvent) => {
        if (!this.pickEnabled) return;
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

    private _computeViewProjMatrix(): void {
        if (!this.map) return;
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
    }

    private _doPrerenderGeometry(): void {
        if (!this.map || !this.vectorSource || !this.isRebuildWaterGeometry) {
            return;
        }
        if (this.map.getZoom() <= this.minZoom) return;
        this._computeViewProjMatrix();
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
            const hasTerrain = !!this.map?.getTerrain();
            const buildGeoFromPolygon = (polygon: Position[][]) => {
                const maxSeg = hasTerrain ? 200 : 0;
                const {vertices, indices} = triangulatePolygonWithHoles(polygon, maxSeg);
                const geo = buildGeo(vertices, indices);
                reverseFaceWinding(geo);
                // Apply per-vertex terrain elevation for water surface
                if (hasTerrain && this.map) {
                    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
                    for (let i = 0; i < posAttr.count; i++) {
                        const localX = posAttr.getX(i);
                        const localY = posAttr.getY(i);
                        const latLon = tileLocalToLatLon(
                            this._zoom, rootTile.tileX, rootTile.tileY,
                            localX, localY,
                        );
                        const elev = this.map.queryTerrainElevation([latLon.lon, latLon.lat]);
                        if (elev !== null) {
                            posAttr.setZ(i, elev);
                        }
                    }
                    posAttr.needsUpdate = true;
                }
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
        const tr = this.map.transform as any;
        if(tr.zoom <= this.minZoom) return;
        this._computeViewProjMatrix();
        for (const tile of this._visibleTiles) {
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (tile_key === this.tilekeyToDrawWater) {
                const tileMatrix = calculateTileMatrixThree(tile.toUnwrapped(), tr.worldSize);
                this.camera.projectionMatrix = new THREE.Matrix4().multiplyMatrices(this._viewProjMatrix, tileMatrix);
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

    applyWaterSettings(settings: Partial<WaterSettings>): void {
        this.waterMaterial?.applySettings(settings);
    }

    getWaterSettings(): WaterSettings | null {
        return this.waterMaterial?.getSettings() ?? null;
    }
}
