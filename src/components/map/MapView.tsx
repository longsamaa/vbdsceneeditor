// MapView.tsx
import React, {useEffect, useRef, forwardRef, useImperativeHandle, useState} from 'react';
import maplibregl from 'maplibre-gl';
import type {WebGLContextAttributesWithType} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css';
import './MapView.css'
import {type EditableLayer, LayerEditControl} from '../toolbar/LayerEditCtrl'
import {Map4DModelsThreeLayer} from './Layer4DModels.ts'
import {OverlayLayer} from './gizmo/OverlayLayer'
import {getSunPosition} from './shadow/ShadowHelper.ts'
import OutlineLayer from './gizmo/OutlineLayer.ts'
import type {TransformMode} from '../toolbar/TransformToolbar'
import {loadModelFromGlb} from './model/objModel.ts'
import {EditLayer} from "./EditLayer.ts";
import type {Custom3DTileRenderLayer} from "./Interface.ts";
import {CustomEditLayerManager} from "./CustomEditLayerManager.ts"

interface MapViewProps {
    center?: [number, number];
    zoom?: number;
    style?: React.CSSProperties;
}

export interface MapViewHandle {
    //set loai transform cho overlay layer
    setTransformMode(m: TransformMode): void;

    //reset pos cua object select
    resetPosOfObjectSelected(): void;

    //snap object selected to ground : void
    snapObjectSelectedToGround(): void;

    //enable clipping plane de cat pos < 0
    enableClippingPlanesObjectSelected(enable: boolean): void;

    //bat footprint khi dang edit project to plane z (0,0,1)
    enableFootPrintWhenEdit(enable: boolean): void;
}

function uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function createOverLayer(): OverlayLayer {
    const overlay_layer_id = import.meta.env.VITE_OVERLAY_LAYER_ID;
    return new OverlayLayer({
        id: overlay_layer_id
    });
}

function createOutlineLayer(): OutlineLayer {
    const outline_layer_id = import.meta.env.VITE_OUTLINE_LAYER_ID;
    return new OutlineLayer({
        id: outline_layer_id
    });
}

function createNewEditorLayer(map: maplibregl.Map): EditLayer {
    const id = uuid();
    const center = map.getCenter();
    const sunPos = getSunPosition(center.lat, center.lng);
    const sun_options = {
        shadow: true,
        altitude: sunPos.altitude,
        azimuth: sunPos.azimuth,
    }
    const new_edit_layer = new EditLayer({
        id: id,
        sun: sun_options,
        editorLevel: 16,
        applyGlobeMatrix: false,
        onPick: (info) => {
        },
        onPickfail: () => {
        }
    });
    return new_edit_layer;
}

function addEditorLayerToMap(
    map: maplibregl.Map | null,
    overlayLayer: OverlayLayer | null,
    outlineLayer: OutlineLayer | null,
    layerMap: Map<string, Custom3DTileRenderLayer> | null | undefined,
) {
    if (!map || !outlineLayer) return;
    const new_editor_layer = createNewEditorLayer(
        map,
    );
    const str_glb_path_array = ['/test_data/windmill__animated.glb'];
    str_glb_path_array.forEach((path) => {
        loadModelFromGlb(path)
            .then((modeldata) => {
                console.log(modeldata);
                new_editor_layer.addObjectsToCache([{
                    id: path,
                    modeldata
                }]);
                new_editor_layer.addObjectToScene(path, 100);
            })
            .catch((e) => {
                console.error('Load GLB failed:', path, e);
            });
    });
    layerMap?.set(new_editor_layer.id, new_editor_layer);
    if (overlayLayer) {
        map.addLayer(new_editor_layer, overlayLayer.id);
    }
}


function createDefaultMap(map: maplibregl.Map, overlay_layer: OverlayLayer, outline_layer: OutlineLayer): void {
    const center = map.getCenter();
    const vectorSourceUrl = import.meta.env.VITE_MAP4D_TILE_URL;
    const rootModelUrl = import.meta.env.VITE_ROOT_MODEL_URL;
    const sourceLayer = "map4d_3dmodels";
    //add overlay layer
    const sunPos = getSunPosition(center.lat, center.lng);
    const sun_options = {
        shadow: true,
        altitude: sunPos.altitude,
        azimuth: sunPos.azimuth,
    }
    //example layer
    const map4d_layer = new Map4DModelsThreeLayer({
        id: 'test_layer',
        vectorSourceUrl: vectorSourceUrl,
        sourceLayer: sourceLayer,
        rootUrl: rootModelUrl,
        minZoom: 16,
        maxZoom: 19,
        sun: sun_options,
        onPick: (info) => {
            overlay_layer.setCurrentTileID(info.overScaledTileId);
            overlay_layer.attachGizmoToObject(info.object);
            outline_layer?.setCurrentTileID(info.overScaledTileId);
            outline_layer?.attachObject(info.object);
        },
        onPickfail: () => {
            overlay_layer.unselect();
            outline_layer?.unselect();
            console.log('pick fail');
        }
    });
    map4d_layer.setSunPos(sunPos.altitude, sunPos.azimuth);
    map.addLayer(map4d_layer);
}

function addControlMaplibre(map: maplibregl.Map): void {
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(({
                                                             center = [106.72917030411851, 10.797981541869406],
                                                             zoom = 12
                                                         }, ref) => {
    //ref map container va maplibre
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const editorLayerManager = useRef<CustomEditLayerManager | null>(null);
    //tao overlay layer ref
    const overlay_layer = useRef<OverlayLayer | null>(null);
    //tao outline layer
    const outline_layer = useRef<OutlineLayer | null>(null);
    //layers
    const [customlayers, setCustomLayers] = useState<EditableLayer[]>([]);
    useEffect(() => {
        if (!mapContainer.current) return;
        //create map cache
        editorLayerManager.current = new CustomEditLayerManager();
        const style_path = import.meta.env.VITE_STYLE_PATH;

        let canvas_config: WebGLContextAttributesWithType = {};
        const is_high_performance_render = import.meta.env.VITE_HIGH_PERFORMANCE_RENDER;
        if (is_high_performance_render === 'true') {
            canvas_config = {
                antialias: true,
                powerPreference: 'high-performance',
                contextType: 'webgl2',
            }
        }
        // Khởi tạo map
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: style_path, // Free demo tiles
            center: center,
            zoom: zoom,
            pitch: 60,
            bearing: -60,
            canvasContextAttributes: canvas_config
        });
        // Thêm controls
        addControlMaplibre(map.current);
        //map.current.showTileBoundaries = true;
        // Tao overlay truoc
        overlay_layer.current = createOverLayer();
        // Tao outline Layer
        outline_layer.current = createOutlineLayer();
        // Event listeners
        map.current.on('load', () => {
            console.log('Map loaded successfully');
            if (map.current && overlay_layer.current && outline_layer.current) {
                //tao lop overlay truoc
                createDefaultMap(map.current, overlay_layer.current, outline_layer.current);
                //outline layer gan cuoi
                map.current.addLayer(outline_layer.current);
                //them overlay cuoi cung
                map.current.addLayer(overlay_layer.current);
            }
        });
        map.current.on('styledata', () => {
            const layers = map.current?.style._layers;
            setCustomLayers([]);
            const layers_edit: EditableLayer[] = [];
            if (layers) {
                for (const [id, layer] of Object.entries(layers)) {
                    const overlay_layer_id = import.meta.env.VITE_OVERLAY_LAYER_ID;
                    const outline_layer_id = import.meta.env.VITE_OUTLINE_LAYER_ID;
                    if (layer.type === "custom" && id !== overlay_layer_id && id !== outline_layer_id) {
                        const customLayer = editorLayerManager.current?.layer_cache.get(id);
                        if (customLayer) {
                            layers_edit.push({
                                    id: id,
                                    name: 'name',
                                    isVisible: customLayer.visible,
                                }
                            )
                        }
                    }
                }
                setCustomLayers(layers_edit);
            }

        });
        // Cleanup
        return () => {
            if (map.current) {
                map.current.remove();
            }
        };
    }, []);
    //Nhan su kien handle map ref
    useImperativeHandle(ref, () => ({
        setTransformMode(mode) {
            if (mode !== 'reset') {
                overlay_layer.current?.setMode(mode);
            }
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
            if (overlay_layer.current) {
                overlay_layer.current.enableLocalClippingPlane(enable);
            }
        },
        enableFootPrintWhenEdit(enable: boolean) {
            //bat footprint cho object dang select
            overlay_layer.current?.showFootprint(enable);
            map.current?.triggerRepaint();
        },
    }));
    return (
        <div className="map-root">
            {/* Map container */}
            <div
                ref={mapContainer}
                className="map-container"
            />
            {/* Layer Edit Control overlay */}
            <LayerEditControl
                layers={customlayers}
                onAdd={() => {
                    addEditorLayerToMap(
                        map.current,
                        overlay_layer.current,
                        outline_layer.current,
                        editorLayerManager.current?.layer_cache
                    );
                }}
                onSelect={(id) => {
                    editorLayerManager?.current?.setPickHandler((info) => {
                    });
                    editorLayerManager?.current?.setPickFailHandler(() => {
                    });
                    editorLayerManager?.current?.setCurrentLayer(id);
                    editorLayerManager?.current?.setPickHandler((info) => {
                        overlay_layer.current?.setCurrentTileID(info.overScaledTileId);
                        overlay_layer.current?.attachGizmoToObject(info.object);
                        outline_layer.current?.setCurrentTileID(info.overScaledTileId);
                        outline_layer.current?.attachObject(info.object);
                    });
                    editorLayerManager?.current?.setPickFailHandler(() => {
                    });
                    map.current?.triggerRepaint();
                }}
                onVisibleLayer={(id, visible) => {
                    const layer = editorLayerManager?.current?.layer_cache.get(id);
                    if (layer) {
                        layer.visible = visible;
                    }
                    map.current?.triggerRepaint();
                }}
                onDeleteLayer={(id) => {
                    const layer = editorLayerManager?.current?.layer_cache.get(id);
                    if (layer) {
                        if (map.current?.getLayer(id)) {
                            map.current?.removeLayer(id);
                        }
                    }
                    editorLayerManager?.current?.removeLayer(id);
                }}
            />
        </div>
    );
});
export default MapView;