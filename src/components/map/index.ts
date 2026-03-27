// ── Interfaces & Types ──
export type {
    Custom3DTileRenderLayer,
    ShadowCasterLayer,
    ReflectionCasterLayer,
    PickHit,
    UserData,
    ShadowUserData,
    LightGroup,
    LightGroupOption,
    SunOptions,
    SunParamater,
    ModelData,
    ObjectInfo,
    LocalCoordinate,
    LatLon,
    ShadowParam,
    ShadowPair,
} from './Interface';

// ── 3D Layer ──
export { Map4DModelsThreeLayer } from './3dlayer/ThreeDLayer';
export { ModelFetch } from './3dlayer/ModelFetch';
export type { ModelCacheEntry } from './3dlayer/ModelFetch';

// ── Instance Layer ──
export { InstanceLayer } from './instance/InstanceLayer';
export type { InstanceLayerOpts, InstanceShadowPair, DataTileInfoForInstanceLayer } from './instance/InstanceLayer';
export { default as InstancedGroupMesh } from './instance/InstancedGroupMesh';

// ── Water ──
export { WaterLayer } from './water/WaterLayer';
export type { WaterLayerOpts } from './water/WaterLayer';
export { createWaterMaterial, WaterReflectionMaterial } from './water/WaterMaterial';
export type { WaterOpts } from './water/WaterMaterial';
export { WaterRenderTarget } from './water/WaterRenderTarget';
export { ReflectionPass, getSharedReflectionPass } from './water/ReflectionPass';
export { ReflectionOrchestrator } from './water/ReflectionOrchestrator';
export { createWaterReflectionMatrix } from './water/WaterCamera';

// ── Shadow ──
export { ShadowDepthMaterial, ShadowLitMaterial, GroundShadowMaterial, InstanceShadowMaterial } from './shadow/ShadowLitMaterial';
export { ShadowMapPass, getSharedShadowPass } from './shadow/ShadowMapPass';
export { ShadowOrchestrator } from './shadow/ShadowOrchestrator';
export { MaplibreShadowMesh, GroundShadowMesh } from './shadow/ShadowGeometry';
export { ShadowRenderTarget } from './shadow/ShadowRenderTarget';
export {
    perspective,
    calculateTileMatrixThree,
    createMapLibreMatrix,
    createShadowMapMatrix,
    createShadowMapMatrixOrtho,
    createSunOrthoShadowMatrix,
    createOrthoMatrix,
} from './shadow/ShadowCamera';
export {
    createSunLightArrow,
    calculateSunDirectionMaplibre,
    getSunPosition,
    getTimeOfDayColors,
    buildShadowMatrix,
} from './shadow/ShadowHelper';
export type { TimeOfDayColors } from './shadow/ShadowHelper';

// ── Edit Layer ──
export { EditLayer } from './edit/EditLayer';
export type { EditorLayerOpts, ObjectDefine, EditorModelData, DataTileInfoForEditorLayer } from './edit/EditLayer';

// ── Gizmo / Overlay ──
export { default as OutlineLayer } from './gizmo/OutlineLayer';
export type { OutlineLayerOptions } from './gizmo/OutlineLayer';
export { OverlayLayer } from './gizmo/OverlayLayer';
export type { OverlayLayerOptions, TransformSnapshot } from './gizmo/OverlayLayer';

// ── Data Source ──
export { CustomVectorSource } from './source/CustomVectorSource';
export type { CustomVectorSourceOpts, GetTileOptions } from './source/CustomVectorSource';
export { CustomGeoJsonSource } from './source/CustomGeoJsonSource';
export type { CustomGeoJsonSourceOpts, GeoJsonFeature } from './source/CustomGeoJsonSource';
export { vectorTileToJSON, buildGeo, triangulatePolygonWithHoles } from './source/GeojsonConverter';
export type { JsonVectorTile, JsonVectorTileLayer, JsonVectorTileFeature } from './source/GeojsonConverter';
export type { CustomSource, TileSource, VectorSourceLike, VectorTileData, DataTileState } from './source/SourceInterface';

// ── Coordinate Conversion ──
export {
    clamp,
    deg2rad,
    worldSize,
    getMetersPerPixelAtLatitude,
    getMetersPerExtentUnit,
    tileLocalToLatLon,
    latlonToLocal,
    projectToWorldCoordinates,
} from './convert/map_convert';

// ── Model Utilities ──
export {
    createYupToZUpMatrix,
    reverseFaceWinding,
} from './model/objModel';

// ── Tile Utilities ──
export { parseLayerTileInfo } from './tile/tile';
export { requestAsync } from './tile/request';

// ── Shared Renderer ──
export { getSharedRenderer, disposeSharedRenderer } from './SharedRenderer';
