// MapView.tsx
import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import './MapView.css'
import {type EditableLayer, LayerEditControl} from '../toolbar/LayerEditCtrl'
import {Map4DModelsThreeLayer} from './3dlayer/ThreeDLayer.ts'
import {OverlayLayer} from './gizmo/OverlayLayer'
import OutlineLayer from './gizmo/OutlineLayer.ts'
import type {TransformMode} from '../toolbar/TransformToolbar'
import {loadModelFromGlb, decomposeObject, parseUrl} from './model/objModel.ts'
import {EditLayer} from "./edit/EditLayer.ts";
import {latlonToLocal} from "./convert/map_convert.ts";
import type {Custom3DTileRenderLayer} from "./Interface.ts";
import {CustomEditLayerManager} from "./CustomEditLayerManager.ts"
import {WaterLayer} from "./water/WaterLayer.ts"
import {CustomVectorSource} from "./source/CustomVectorSource.ts"
import {InstanceLayer} from "./instance/InstanceLayer.ts"
import {ShadowOrchestrator} from "./shadow/ShadowOrchestrator.ts"
import {ReflectionOrchestrator} from "./water/ReflectionOrchestrator.ts"
import {deleteModelFromDb, saveModelToDb} from "./api/modelApi.ts"
import {getSharedShadowPass} from "./shadow/ShadowMapPass.ts"
import {getSunPosition} from "./shadow/ShadowHelper.ts"
import {ObjectTreePanel, type TileNode} from "../toolbar/ObjectTreePanel.tsx"
import {PropertiesPanel, type ObjectProperties} from "../toolbar/PropertiesPanel.tsx"
import {GraphicsSettings, type GraphicsConfig} from "../toolbar/GraphicsSettings.tsx"

interface MapViewProps {
    center?: [number, number];
    zoom?: number;
    style?: React.CSSProperties;
}

export interface MapViewHandle {
    setTransformMode(m: TransformMode): void;
    resetPosOfObjectSelected(): void;
    snapObjectSelectedToGround(): void;
    enableClippingPlanesObjectSelected(enable: boolean): void;
    enableFootPrintWhenEdit(enable: boolean): void;
}

function uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function buildPropsFromObject(obj: THREE.Object3D): ObjectProperties {
    const ud = obj.userData;
    const decomposed = decomposeObject(obj);
    return {
        gid: ud.gid ?? null,
        id: ud.id ?? null,
        name: ud.name ?? obj.name ?? '',
        longitude: decomposed.latlon?.lon ?? null,
        latitude: decomposed.latlon?.lat ?? null,
        scale: decomposed.scale ?? 1,
        bearing: decomposed.bearing ?? 0,
        elevation: decomposed.elevation ?? 0,
        height: decomposed.height ?? null,
        startdate: ud.startdate ?? null,
        enddate: ud.enddate ?? null,
        modeltype: ud.modeltype ?? null,
        modelname: ud.modelname ?? null,
        modelurl: ud.modelurl ?? null,
        texturename: ud.texturename ?? null,
        textureurl: ud.textureurl ?? null,
        tileKey: ud.tile ? `${ud.tile.z}/${ud.tile.x}/${ud.tile.y}` : null,
    };
}

// Cache env vars at module level
const OVERLAY_LAYER_ID = import.meta.env.VITE_OVERLAY_LAYER_ID;
const OUTLINE_LAYER_ID = import.meta.env.VITE_OUTLINE_LAYER_ID;
const MAP4D_LAYER_ID = import.meta.env.VITE_MAP4D_LAYER_ID ?? 'test_layer';
const HIGH_PERFORMANCE_RENDER = import.meta.env.VITE_HIGH_PERFORMANCE_RENDER === 'true';
const VECTOR_SOURCE_URL = import.meta.env.VITE_MAP4D_TILE_URL;
const ROOT_MODEL_URL = import.meta.env.VITE_ROOT_MODEL_URL;

function createSunOptions(lat: number, lon: number) {
    const pos = getSunPosition(lat, lon);
    return {
        shadow: true,
        altitude: pos.altitude,
        azimuth: pos.azimuth,
        lat,
        lon,
    };
}

function createOverLayer(): OverlayLayer {
    return new OverlayLayer({ id: OVERLAY_LAYER_ID });
}

function createOutlineLayer(): OutlineLayer {
    return new OutlineLayer({ id: OUTLINE_LAYER_ID });
}

function createNewEditorLayer(map: maplibregl.Map): EditLayer {
    const new_edit_layer = new EditLayer({
        id: uuid(),
        editorLevel: 16,
        applyGlobeMatrix: false,
        onPick: () => {},
        onPickfail: () => {}
    });
    const map4d_layer = map.getLayer(MAP4D_LAYER_ID) as unknown as Custom3DTileRenderLayer;
    if (map4d_layer) {
        new_edit_layer.setLayerSourceCastShadow(map4d_layer);
    }
    return new_edit_layer;
}

function addEditorLayerToMap(
    map: maplibregl.Map | null,
    overlayLayer: OverlayLayer | null,
    outlineLayer: OutlineLayer | null,
    layerMap: Map<string, Custom3DTileRenderLayer> | null | undefined,
) {
    if (!map || !outlineLayer) return;
    const new_editor_layer = createNewEditorLayer(map);
    layerMap?.set(new_editor_layer.id, new_editor_layer);
    if (map.getLayer(MAP4D_LAYER_ID)) {
        map.addLayer(new_editor_layer, MAP4D_LAYER_ID);
    } else if (overlayLayer) {
        map.addLayer(new_editor_layer, overlayLayer.id);
    } else {
        map.addLayer(new_editor_layer);
    }

    // Default add Crane3d.glb
    const defaultGlbUrl = ' ';
    loadModelFromGlb(defaultGlbUrl)
        .then((modeldata) => {
            const fileName = parseUrl(defaultGlbUrl).fileName;
            new_editor_layer.addObjectsToCache([{ url: defaultGlbUrl, modeldata }]);
            const center = map.getCenter();
            new_editor_layer.addObjectToScene(fileName, center.lat, center.lng, 10);
            map.triggerRepaint();
        })
        .catch((e) => console.error('Load default GLB failed:', e));

    return new_editor_layer;
}

function addObjectToEditLayer(
    map: maplibregl.Map | null,
    layer: Custom3DTileRenderLayer | null | undefined,
    file: File,
) {
    if (!map || !layer) return;
    const editLayer = layer as EditLayer;
    const url = URL.createObjectURL(file);
    const fileName = file.name;
    loadModelFromGlb(url)
        .then((modeldata) => {
            editLayer.addObjectsToCache([{ url: fileName, modeldata }]);
            const center = map.getCenter();
            editLayer.addObjectToScene(fileName, center.lat, center.lng, 10);
            URL.revokeObjectURL(url);
            map.triggerRepaint();
        })
        .catch((e) => {
            console.error('Load GLB failed:', fileName, e);
            URL.revokeObjectURL(url);
        });
}

function addObjectToEditLayerFromUrl(
    map: maplibregl.Map | null,
    layer: Custom3DTileRenderLayer | null | undefined,
    modelUrl: string,
) {
    if (!map || !layer) return;
    const editLayer = layer as EditLayer;
    const fileName = parseUrl(modelUrl).fileName;
    loadModelFromGlb(modelUrl)
        .then((modeldata) => {
            editLayer.addObjectsToCache([{ url: modelUrl, modeldata }]);
            const center = map.getCenter();
            editLayer.addObjectToScene(fileName, center.lat, center.lng, 10);
            map.triggerRepaint();
        })
        .catch((e) => {
            console.error('Load GLB from URL failed:', modelUrl, e);
        });
}

function createDefaultMap(map: maplibregl.Map, overlay_layer: OverlayLayer, outline_layer: OutlineLayer, layerManager: CustomEditLayerManager): void {
    const center = map.getCenter();
    const sun_options = createSunOptions(center.lat, center.lng);

    // map.setBearing(sun_options.azimuth - 180);
    // map.setPitch(90);

    const map4dSource = new CustomVectorSource({
        id: 'map4d source',
        url: VECTOR_SOURCE_URL,
        minZoom: 0,
        maxZoom: 18,
        tileSize: 512,
        maxTileCache: 1024,
        map,
    });

    const map4d_layer = new Map4DModelsThreeLayer({
        id: 'test_layer',
        sourceLayer: 'map4d_3dmodels',
        rootUrl: ROOT_MODEL_URL,
        minZoom: 14,
        maxZoom: 19,
        // onPick: (info) => {
        //     overlay_layer.setCurrentTileID(info.overScaledTileId);
        //     overlay_layer.attachGizmoToObject(info.object);
        //     outline_layer.setCurrentTileID(info.overScaledTileId);
        //     outline_layer.attachObject(info.object);
        // },
        // onPickfail: () => {
        //     overlay_layer.unselect();
        //     outline_layer.unselect();
        // }
    });
    map4d_layer.setVectorSource(map4dSource);

    // Set sun on shared shadow pass
    getSharedShadowPass(8192).setSunOptions(sun_options);

    // Shadow orchestrator - add FIRST so its render() runs shadow passes before other layers' render()
    const shadowOrchestrator = new ShadowOrchestrator('shadow-orchestrator');
    map.addLayer(shadowOrchestrator);

    map4d_layer.useOrchestrator = true;
    map.addLayer(map4d_layer);

    // Water layer
    const customSource = new CustomVectorSource({
        id: 'test-custom-source',
        url: 'https://images.daklak.gov.vn/v2/tile/{z}/{x}/{y}/306ec9b5-8146-4a83-9271-bd7b343a574a',
        minZoom: 0,
        maxZoom: 16,
        tileSize: 512,
        maxTileCache: 1024,
        map,
    });
    // Instance layer
    const instanceCustomSource = new CustomVectorSource({
        id: 'test-custom-source',
        url: 'http://10.222.3.81:8083/VietbandoMapService/api/image/?Function=GetVectorTile&MapName=IndoorNavigation&Level={z}&TileX={x}&TileY={y}&UseTileCache=true',
        minZoom: 0,
        maxZoom: 16,
        tileSize: 512,
        maxTileCache: 1024,
        map,
    });
    const instance_layer = new InstanceLayer({
        id: 'example_tree',
        sourceLayer: 'trees',
        applyGlobeMatrix: false,
        objectUrl: [
            '/test_data/test_instance/tree2.glb',
            '/test_data/test_instance/tree3.glb',
            '/test_data/test_instance/tree4.glb',
            '/test_data/test_instance/tree5.glb',
            '/test_data/test_instance/tree6.glb']
    });
    instance_layer.setLightOption({
        directional: { intensity: 2.0 },
        hemisphere: { intensity: 1.5 }
    });
    instance_layer.setVectorSource(instanceCustomSource);
    instance_layer.setLayerSourceCastShadow(map4d_layer);
    instance_layer.useOrchestrator = true;
    map.addLayer(instance_layer);

    // Edit layer
    const edit_layer = new EditLayer({
        id: 'edit_layer',
        editorLevel: 16,
        applyGlobeMatrix: false,
    });
    edit_layer.useOrchestrator = true;
    map.addLayer(edit_layer, map4d_layer.id);

    // Load edit models
    const editModels = [
        { path: 'http://10.222.3.84:9000/indoornavigation/Crane3d.glb', lat: 10.793856786820447, lon: 106.71976547330198, scale: 10 },
        { path: 'http://10.222.3.84:9000/indoornavigation/Windmill.glb', lat: 10.794683052183178, lon: 106.7191509814821, scale: 20 },
    ];
    for (const { path, lat, lon, scale } of editModels) {
        loadModelFromGlb(path)
            .then((modeldata) => {
                edit_layer.addObjectsToCache([{ url: path, modeldata }]);
                edit_layer.addObjectToScene(parseUrl(path).fileName, lat, lon, scale);
            })
            .catch((e) => console.error('Load GLB failed:', path, e));
    }

    map4d_layer.setLayerSourceCastShadow(edit_layer);

    // Register all shadow casters
    shadowOrchestrator.register(edit_layer);
    shadowOrchestrator.register(map4d_layer);
    shadowOrchestrator.register(instance_layer);

    // Register layers in layer manager for panel display
    layerManager.addNewLayer(map4d_layer.id, map4d_layer);
    layerManager.addNewLayer(instance_layer.id, instance_layer);
    layerManager.addNewLayer(edit_layer.id, edit_layer);


    //reflection orchestrator render add vao cuoi cung 

    ReflectionOrchestrator
    const reflectionOrchestrator = new ReflectionOrchestrator('reflection-orchestrator');
    map.addLayer(reflectionOrchestrator); 
    reflectionOrchestrator.register(map4d_layer); 

    const waterLayer = new WaterLayer({
        id: 'test_water_layer',
        applyGlobeMatrix: false,
        sourceLayer: 'region_river_index',
        normalUrl: '/normal/4141-normal.jpg',
        sun: sun_options,
    });
    waterLayer.setVectorSource(customSource);
    map.addLayer(waterLayer);
}

function addControlMaplibre(map: maplibregl.Map): void {
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
}

function buildEditableLayers(
    layers: Record<string, { type: string }> | undefined,
    layerCache: Map<string, Custom3DTileRenderLayer> | undefined,
): EditableLayer[] {
    if (!layers || !layerCache) return [];
    const result: EditableLayer[] = [];
    for (const [id, layer] of Object.entries(layers)) {
        if (layer.type !== 'custom' || id === OVERLAY_LAYER_ID || id === OUTLINE_LAYER_ID || id === 'shadow-orchestrator') continue;
        const customLayer = layerCache.get(id);
        if (customLayer) {
            const isEdit = customLayer instanceof EditLayer;
            result.push({ id, name: id, isVisible: customLayer.visible, canAddObject: isEdit });
        }
    }
    return result;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(({
                                                             center = [106.72917030411851, 10.797981541869406],
                                                             zoom = 12
                                                         }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const editorLayerManager = useRef<CustomEditLayerManager | null>(null);
    const overlay_layer = useRef<OverlayLayer | null>(null);
    const outline_layer = useRef<OutlineLayer | null>(null);
    const [customlayers, setCustomLayers] = useState<EditableLayer[]>([]);
    const [treeData, setTreeData] = useState<{ layerId: string; tiles: TileNode[] } | null>(null);
    const [selectedProps, setSelectedProps] = useState<ObjectProperties | null>(null);
    const [activeLayerEditable, setActiveLayerEditable] = useState(false);
    const [activeLayerIsDb, setActiveLayerIsDb] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
    const pickedObject = useRef<THREE.Object3D | null>(null);

    useEffect(() => {
        if (!mapContainer.current) return;
        editorLayerManager.current = new CustomEditLayerManager();

        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: 'style/vbd_style.json',
            center,
            zoom: 16,
            pitch: 60,
            bearing: 67.97536302882756,
            pixelRatio: Math.min(window.devicePixelRatio, 2),
            maxZoom: 22,
            canvasContextAttributes: HIGH_PERFORMANCE_RENDER ? { antialias: true } : {}
        });
        //map.current._showTileBoundaries = true;
        addControlMaplibre(map.current);

        overlay_layer.current = createOverLayer();
        overlay_layer.current.onTransformChange = (obj) => {
            setSelectedProps(buildPropsFromObject(obj));
        };
        outline_layer.current = createOutlineLayer();

        map.current.on('load', () => {
            if (!map.current || !overlay_layer.current || !outline_layer.current || !editorLayerManager.current) return;
            createDefaultMap(map.current, overlay_layer.current, outline_layer.current, editorLayerManager.current);
            map.current.addLayer(outline_layer.current);
            map.current.addLayer(overlay_layer.current);
        });

        map.current.on('styledata', () => {
            const layers = map.current?.style._layers;
            const newLayers = buildEditableLayers(
                layers as any,
                editorLayerManager.current?.layer_cache,
            );
            setCustomLayers(newLayers);
        });

        map.current.on('resize', () => {
            if (!map.current) return;
            const canvas = map.current.getCanvas();
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            outline_layer.current?.resize(w, h);
        });

        return () => map.current?.remove();
    }, []);

    useImperativeHandle(ref, () => ({
        setTransformMode(mode) {
            if (mode !== 'reset') overlay_layer.current?.setMode(mode);
            map.current?.triggerRepaint();
        },
        resetPosOfObjectSelected() {
            overlay_layer.current?.reset();
            map.current?.triggerRepaint();
        },
        snapObjectSelectedToGround() {
            overlay_layer.current?.snapCurrentObjectToGround();
            map.current?.triggerRepaint();
        },
        enableClippingPlanesObjectSelected(enable: boolean) {
            overlay_layer.current?.enableLocalClippingPlane(enable);
        },
        enableFootPrintWhenEdit(enable: boolean) {
            overlay_layer.current?.showFootprint(enable);
            map.current?.triggerRepaint();
        },
    }));

    const handleAdd = useCallback(() => {
        addEditorLayerToMap(
            map.current,
            overlay_layer.current,
            outline_layer.current,
            editorLayerManager.current?.layer_cache
        );
    }, []);

    const handleSelect = useCallback((id: string) => {
        const mgr = editorLayerManager.current;
        if (!mgr) return;
        // Clear previous selection
        overlay_layer.current?.unselect();
        outline_layer.current?.unselect();
        pickedObject.current = null;
        setSelectedProps(null);
        mgr.setCurrentLayer(id);
        const layer = mgr.layer_cache.get(id);
        const isEdit = layer instanceof EditLayer;
        setActiveLayerEditable(isEdit);
        setActiveLayerIsDb(!isEdit);
        mgr.setPickHandler((info) => {
            overlay_layer.current?.setCurrentTileID(info.overScaledTileId);
            overlay_layer.current?.attachGizmoToObject(info.object);
            outline_layer.current?.setCurrentTileID(info.overScaledTileId);
            outline_layer.current?.attachObject(info.object);
            pickedObject.current = info.object;
            setSelectedProps(buildPropsFromObject(info.object));
            map.current?.triggerRepaint();
        });
        mgr.setPickFailHandler(() => {
            overlay_layer.current?.unselect();
            outline_layer.current?.unselect();
            pickedObject.current = null;
            setSelectedProps(null);
        });
        // Update object tree panel
        if (isEdit && layer instanceof EditLayer) {
            setTreeData({ layerId: id, tiles: layer.getTileObjectTree() });
        } else {
            setTreeData(null);
        }
        map.current?.triggerRepaint();
    }, []);

    const handleVisibleLayer = useCallback((id: string, visible: boolean) => {
        const layer = editorLayerManager.current?.layer_cache.get(id);
        if (layer) layer.visible = visible;
        map.current?.triggerRepaint();
    }, []);

    const refreshTreeData = useCallback((layerId: string) => {
        const layer = editorLayerManager.current?.layer_cache.get(layerId);
        if (layer && layer instanceof EditLayer) {
            setTreeData({ layerId, tiles: layer.getTileObjectTree() });
        }
    }, []);

    const handleAddObject = useCallback((layerId: string, file: File) => {
        const layer = editorLayerManager.current?.layer_cache.get(layerId);
        addObjectToEditLayer(map.current, layer, file);
        setTimeout(() => refreshTreeData(layerId), 1000);
    }, []);

    const handleAddObjectFromUrl = useCallback((layerId: string, url: string) => {
        const layer = editorLayerManager.current?.layer_cache.get(layerId);
        addObjectToEditLayerFromUrl(map.current, layer, url);
        setTimeout(() => refreshTreeData(layerId), 1000);
    }, []);

    const handleDeleteLayer = useCallback((id: string) => {
        if (map.current?.getLayer(id)) {
            map.current.removeLayer(id);
        }
        editorLayerManager.current?.removeLayer(id);
    }, []);

    const handleGraphicsChange = useCallback((config: GraphicsConfig) => {
        const shadowPass = getSharedShadowPass();
        shadowPass.resizeShadowMap(config.shadowMapSize);
        if (map.current) {
            map.current.setPixelRatio(config.pixelRatio);
        }
        map.current?.triggerRepaint();
    }, []);

    const handleToggleBoundaries = useCallback((visible: boolean) => {
        if (!map.current) return;
        (map.current as any)._showTileBoundaries = visible;
        map.current.triggerRepaint();
    }, []);

    return (
        <div className="map-root">
            <div ref={mapContainer} className="map-container" />
            <LayerEditControl
                layers={customlayers}
                onAdd={handleAdd}
                onSelect={handleSelect}
                onVisibleLayer={handleVisibleLayer}
                onAddObject={handleAddObject}
                onAddObjectFromUrl={handleAddObjectFromUrl}
                onDeleteLayer={handleDeleteLayer}
            />
            {treeData && (
                <ObjectTreePanel
                    layerId={treeData.layerId}
                    tiles={treeData.tiles}
                    onClose={() => setTreeData(null)}
                    onSelectObject={(tileKey, objectIndex) => {
                        const layer = editorLayerManager.current?.layer_cache.get(treeData.layerId);
                        if (!layer || !(layer instanceof EditLayer)) return;
                        const obj = layer.getObjectByTileKeyAndIndex(tileKey, objectIndex);
                        const tileId = layer.getOverscaledTileID(tileKey);
                        if (obj && tileId) {
                            overlay_layer.current?.setCurrentTileID(tileId);
                            overlay_layer.current?.attachGizmoToObject(obj);
                            outline_layer.current?.setCurrentTileID(tileId);
                            outline_layer.current?.attachObject(obj);
                            map.current?.triggerRepaint();
                        }
                    }}
                />
            )}
            {selectedProps && (
                <PropertiesPanel
                    properties={selectedProps}
                    editable={activeLayerEditable}
                    showDbActions={activeLayerIsDb}
                    onClose={() => { setSelectedProps(null); pickedObject.current = null; }}
                    onUpdate={(props) => {
                        const obj = pickedObject.current;
                        if (!obj) return;
                        // Apply changes to object transform
                        const ud = obj.userData;
                        const scaleUnit = ud.scaleUnit;
                        const tile = ud.tile;
                        if (props.longitude != null && props.latitude != null) {
                            const local = latlonToLocal(props.longitude, props.latitude, tile.z);
                            obj.position.set(local.coordX, local.coordY, props.elevation ?? 0);
                        }
                        if (props.scale != null) {
                            const s = props.scale * scaleUnit;
                            obj.scale.set(s, -props.scale, s);
                        }
                        if (props.bearing != null) {
                            obj.rotation.y = THREE.MathUtils.degToRad(props.bearing);
                        }
                        obj.updateMatrix();
                        obj.updateMatrixWorld(true);
                        setSelectedProps(buildPropsFromObject(obj));
                        map.current?.triggerRepaint();
                    }}
                    onSave={(props) => {
                        saveModelToDb(props)
                            .then(async res => {
                                if (res.ok) {
                                    const data = await res.json();
                                    const obj = pickedObject.current;
                                    if (obj) {
                                        obj.userData.gid = data.gid != null ? String(data.gid) : null;
                                        obj.userData.name = data.name ?? obj.userData.name;
                                        obj.userData.startdate = data.startdate ?? null;
                                        obj.userData.enddate = data.enddate ?? null;
                                        obj.userData.modeltype = data.modeltype ?? null;
                                        obj.userData.modelname = data.modelname ?? null;
                                        obj.userData.modelurl = data.modelurl ?? null;
                                        obj.userData.texturename = data.texturename ?? null;
                                        obj.userData.textureurl = data.textureurl ?? null;
                                        setSelectedProps(buildPropsFromObject(obj));
                                    }
                                    // Reset 4d source cache to reload tile data
                                    try {
                                        const map4dLayer = editorLayerManager.current?.layer_cache.get(MAP4D_LAYER_ID) as Map4DModelsThreeLayer | undefined;
                                        map4dLayer?.getVectorSource()?.clearCache();
                                    } catch (e) {
                                        console.warn('clearCache failed:', e);
                                    }
                                    setToast({ msg: 'Saved successfully', type: 'success' });
                                } else {
                                    setToast({ msg: `Save failed: ${res.status}`, type: 'error' });
                                }
                            })
                            .catch((e) => {
                                console.error('Save error:', e);
                                setToast({ msg: 'Save error: network failure', type: 'error' });
                            });
                    }}
                    onDeleteFromDb={(props)=>{
                        if(!props.gid) return; 
                        deleteModelFromDb(props.gid)
                        .then(async res => {
                            if(res.ok){
                                overlay_layer.current?.unselect();
                                outline_layer.current?.unselect();
                                pickedObject.current = null;
                                setSelectedProps(null);
                                try {
                                    const map4dLayer = editorLayerManager.current?.layer_cache.get(MAP4D_LAYER_ID) as Map4DModelsThreeLayer | undefined;
                                    map4dLayer?.getVectorSource()?.clearCache();
                                } catch (e) {
                                    console.warn('clearCache failed:', e);
                                }
                                setToast({ msg: 'Deleted successfully', type: 'success' });
                            }else {
                                setToast({ msg: `Delete failed: ${res.status}`, type: 'error' });
                            }
                        })
                    }}
                />
            )}
            <GraphicsSettings onChange={handleGraphicsChange} onToggleBoundaries={handleToggleBoundaries} />
            {toast && (
                <div
                    style={{
                        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                        padding: '8px 20px', borderRadius: 6, color: '#fff', fontSize: 13,
                        background: toast.type === 'success' ? '#2e7d32' : '#c62828',
                        boxShadow: '0 2px 8px rgba(0,0,0,.3)', zIndex: 9999,
                    }}
                    onAnimationEnd={() => setToast(null)}
                    ref={el => { if (el) setTimeout(() => setToast(null), 2000); }}
                >
                    {toast.msg}
                </div>
            )}
        </div>
    );
});
export default MapView;
