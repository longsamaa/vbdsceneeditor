import maplibregl, {
    MapMouseEvent,
} from 'maplibre-gl';
import {reverseFaceWinding} from '../model/objModel.ts';
import {classifyRings} from '@mapbox/vector-tile';
import {latlonToLocal, clampZoom} from '../convert/map_convert.ts';
import type {
    SunOptions,
    SunParamater,
    PickHit,
    Custom3DTileRenderLayer
} from '../Interface.ts'
import * as THREE from 'three';
import {CustomVectorSource} from "../source/CustomVectorSource.ts"
import {buildGeo, triangulatePolygonWithHoles} from "../source/GeojsonConverter.ts";
import type {Feature, Polygon, MultiPolygon, GeoJsonProperties, Position} from 'geojson';
import {createWaterMaterial} from "./WaterMaterial.ts";
import * as turf from "@turf/turf";
import {calculateSunDirectionMaplibre} from "../shadow/ShadowHelper.ts";

export type WaterLayerOpts = {
    id: string;
    applyGlobeMatrix: boolean;
    sourceLayer: string,
    sun?: SunOptions;
}

export class WaterLayer implements Custom3DTileRenderLayer {
    id: string;
    editorLevel: number = 16;
    visible: boolean = true;
    onPick?: (info: PickHit) => void;
    onPickfail?: () => void;
    sourceLayer: string;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    tileSize: number = 512;
    waterMaterial: THREE.ShaderMaterial | null = null;
    private vectorSource: CustomVectorSource | null = null;
    //private tileCache: Map<string, DataTileInfoForEditorLayer> = new Map<string, DataTileInfoForEditorLayer>();
    //private raycaster = new THREE.Raycaster();
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
    private readonly TILE_EXTENT = 8192;

    constructor(opts: WaterLayerOpts & { onPick?: (info: PickHit) => void } & { onPickfail?: () => void }) {
        this.id = opts.id;
        this.applyGlobeMatrix = opts.applyGlobeMatrix;
        this.onPick = opts.onPick;
        this.onPickfail = opts.onPickfail;
        this.sourceLayer = opts.sourceLayer;
        this.waterNormalTexture = new THREE.TextureLoader().load(
            '/normal/4141-normal.jpg',
            (t) => {
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
            }
        );
        this.waterMaterial = createWaterMaterial({
            color: 0x2a7fff,
            opacity: 1.0,
            tex: this.waterNormalTexture,
        });
        if (opts.sun) {
            this.sun = {
                altitude: opts.sun.altitude,
                azimuth: opts.sun.azimuth,
                sun_dir: calculateSunDirectionMaplibre(THREE.MathUtils.degToRad(opts.sun.altitude),
                    THREE.MathUtils.degToRad(opts.sun.azimuth)),
                shadow: opts.sun.shadow
            }
        }
        if (this.sun) {
            this.waterMaterial.uniforms.lightDir.value = this.sun.sun_dir.clone().normalize();
        }
    }

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.Camera();
        this.camera.matrixAutoUpdate = false;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
        });
        this.renderer.autoClear = false;
        this.renderer.localClippingEnabled = true;
        this.mainScene = new THREE.Scene();
        this.map.on('moveend', () => {
            this.isRebuildWaterGeometry = true;
        })
        map.on('click', this.handleClick);
        this.isRebuildWaterGeometry = true;
    }

    onRemove(): void {
        this.renderer?.dispose();
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
        console.log(e);
       /* if (!this.map || !this.camera || !this.renderer || !this.visible) {
            return;
        }
        // to NDC [-1..1]
        const canvas = this.map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((e.point.x) / rect.width) * 2 - 1,
            -(((e.point.y) / rect.height) * 2 - 1),
        );
        // lấy visible tiles + tile entries đã build scene
        const zoom = clampZoom(this.editorLevel, this.editorLevel, Math.round(this.map.getZoom()));
        const visibleTiles = (this.map).coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        }) as OverscaledTileID[];
        const tr = (this.map).transform;
        if (!tr?.getProjectionData) {
            return;
        }
        let bestHit: {
            dist: number;
            tileKey: string;
            overScaledTileID: OverscaledTileID,
            group: THREE.Object3D
        } | null = null;
        for (const tid of visibleTiles) {
            const canonicalTileID = tid.canonical;
            const key = this.tileKey(canonicalTileID.x, canonicalTileID.y, canonicalTileID.z);
            const tile = this.tileCache.get(key);
            if (!tile?.sceneTile) {
                continue;
            }

            const proj = tr.getProjectionData({
                overscaledTileID: tid,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });

            // ---- manual ray from MVP inverse ----
            const mvp = new THREE.Matrix4().fromArray(proj.mainMatrix);
            const inv = mvp.clone().invert();

            const pNear = new THREE.Vector4(ndc.x, ndc.y, -1, 1).applyMatrix4(inv);
            pNear.multiplyScalar(1 / pNear.w);

            const pFar = new THREE.Vector4(ndc.x, ndc.y, 1, 1).applyMatrix4(inv);
            pFar.multiplyScalar(1 / pFar.w);

            const origin = new THREE.Vector3(pNear.x, pNear.y, pNear.z);
            const direction = new THREE.Vector3(pFar.x, pFar.y, pFar.z).sub(origin).normalize();

            this.raycaster.ray.origin.copy(origin);
            this.raycaster.ray.direction.copy(direction);

            const hits = this.raycaster.intersectObjects(tile.sceneTile.children, true);
            if (hits.length) {
                const h0 = hits[0];
                let obj: THREE.Object3D | null = h0.object;
                while (obj && !obj.userData?.isModelRoot) {
                    obj = obj.parent as THREE.Object3D;
                }
                if (obj) {
                    if (!bestHit || h0.distance < bestHit.dist) {
                        bestHit = {
                            dist: h0.distance,
                            tileKey: key,
                            overScaledTileID: tid,
                            group: obj
                        };
                    }
                }
            }
        }

        if (!bestHit) {
            if (this.onPickfail) {
                this.onPickfail();
            }
            this.map.triggerRepaint();
            return;
        }
        const obj = bestHit.group;
        this.onPick?.({
            dist: bestHit.dist,
            tileKey: bestHit.tileKey,
            object: obj,
            overScaledTileId: bestHit.overScaledTileID
        });
        this.map.triggerRepaint();*/
    };

    prerender(): void {
        if (!this.map || !this.vectorSource || !this.isRebuildWaterGeometry) {
            return;
        }

        const zoom = clampZoom(
            this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom())
        );

        const visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });

        // Cache tiles and check readiness
        let dataNotReady : boolean = false;
        const tileDataMap = new Map();
        for (const tile of visibleTiles) {
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
        const rootTile = latlonToLocal(center.lng, center.lat, zoom);
        this.tilekeyToDrawWater = this.tileKey(rootTile.tileX, rootTile.tileY, zoom);
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

    animate() {
        if (!this.waterMaterial) {
            return;
        }
        this.waterMaterial.uniforms.time.value += 0.016;
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.vectorSource || !this.mainScene) {
            return;
        }
        const zoom = clampZoom(this.vectorSource.minZoom,
            this.vectorSource.maxZoom,
            Math.round(this.map.getZoom()));
        const visibleTiles = this.map.coveringTiles({
            tileSize: this.tileSize,
            minzoom: zoom,
            maxzoom: zoom,
            roundZoom: true,
        });
        const tr = this.map.transform;
        for (const tile of visibleTiles) {
            const projectionData = tr.getProjectionData({
                overscaledTileID: tile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tile_key = this.tileKey(tile.canonical.x, tile.canonical.y, tile.canonical.z);
            if (tile_key === this.tilekeyToDrawWater) {
                const tileMatrix = projectionData.mainMatrix;
                this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
                this.animate();
                this.renderer.resetState();
                this.renderer.render(this.mainScene, this.camera);
                this.map.triggerRepaint();
            }
        }
    }
}