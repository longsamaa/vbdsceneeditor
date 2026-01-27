import type {
    Map,
    OverscaledTileID,
    CustomLayerInterface,
} from 'maplibre-gl';
import MaplibreTransformControls from './MaplibreControl';
import type {HoverParameter} from './MaplibreControl';
import {decomposeObject,objectEnableClippingPlaneZ} from '../model/objModel';
import type {TransformControlsMode} from 'three/examples/jsm/controls/TransformControls.js';
import * as THREE from 'three';
import {MaplibreShadowMesh} from "../shadow/ShadowGeometry";

export type OverlayLayerOptions = {
    id: string;
}
export type TransformSnapshot = {
    position: THREE.Vector3;
    scale: THREE.Vector3;
    quaternion: THREE.Quaternion;
}

export class OverlayLayer implements CustomLayerInterface {
    id: string;
    currentObject: THREE.Object3D | null = null;
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;
    private map: Map | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private scene: THREE.Scene | null = null;
    private current_mode : TransformControlsMode = 'translate';
    private current_local_enable_clipping_plane : boolean = false;
    private show_footprint : boolean = false;
    private transformControl: MaplibreTransformControls | null = null;
    private visible = true;
    private objectTransformSnapShot: TransformSnapshot | null = null;
    private applyGlobeMatrix: boolean | false = false;
    private currentTile: OverscaledTileID | null = null;
    private hoverDiv: HTMLDivElement | null = null;
    private footprintMeshes: MaplibreShadowMesh[] | null = null;

    constructor(opts: OverlayLayerOptions) {
        this.id = opts.id;
        this.createToolTip();
    }

    setCurrentTileID(overTile: OverscaledTileID): void {
        this.currentTile = overTile;
    }

    unselect(): void {
        if (!this.scene) {
            return;
        }
        this.currentTile = null;
        this.currentObject = null;
        this.transformControl?.detach();
        this.scene.clear();
    }

    reset(): void {
        if (!this.objectTransformSnapShot || !this.currentObject) return;
        const obj = this.currentObject;
        obj.position.copy(this.objectTransformSnapShot.position);
        obj.scale.copy(this.objectTransformSnapShot.scale);
        obj.quaternion.copy(this.objectTransformSnapShot.quaternion);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
    }

    showToolTip(parameter: HoverParameter): void {
        if (!this.map || !this.hoverDiv) return;
        const object = parameter.object3D;
        const decompose = decomposeObject(parameter.object3D);
        const canvas = this.map.getCanvas();
        const rect = canvas?.getBoundingClientRect();
        const screenX = (parameter.ndc_x * 0.5 + 0.5) * rect.width + rect.left;
        const screenY = (-parameter.ndc_y * 0.5 + 0.5) * rect.height + rect.top;
        const scale = decompose.scale;
        const bearing = decompose.bearing;
        const tileCoord = decompose.tileCoord;
        const height = decompose.height;
        this.hoverDiv.innerText =
            `Name: ${object.name}
            Id : ${object.id}
            Lat : ${decompose.latlon?.lat}
            Lon : ${decompose.latlon?.lon}
            Tile Coord : ${tileCoord?.x},${tileCoord?.y}
            Elevation : ${decompose.elevation}
            Scale : ${scale?.scaleX},${scale?.scaleY},${scale?.scaleZ}
            Bearing : ${bearing}
            Height : ${height}(m)`;
        this.hoverDiv.style.left = `${screenX}px`;
        this.hoverDiv.style.top = `${screenY}px`;
        this.hoverDiv.style.display = 'block';
    }

    hideToolTip(): void {
        if (!this.hoverDiv) return;
        this.hoverDiv.style.display = 'none';
    }

    snapCurrentObjectToGround(): void {
        if (!this.objectTransformSnapShot || !this.currentObject) return;
        const obj = this.currentObject;
        obj.position.z = 0;
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
    }

    showFootprint(enable: boolean): void {
        this.show_footprint = enable;
        if (!this.currentObject || !this.scene || !this.footprintMeshes) return;
        for (const mesh of this.footprintMeshes) {
            mesh.visible = this.show_footprint;
        }
    }

    applyScaleTransformGizmo(scaleUnit: number): void {
        if (!this.transformControl) return;
        (this.transformControl as unknown as THREE.Object3D).scale.set(1, 1, 1);
        (this.transformControl as unknown as THREE.Object3D).updateMatrix();
        (this.transformControl as unknown as THREE.Object3D).updateMatrixWorld(true);
        (this.transformControl as unknown as THREE.Object3D).scale.set(1, 1, 1 / scaleUnit);
    }

    addMeshFootPrint(): void {
        //traver va tao shadow mesh
        if (!this.currentObject || !this.scene || !this.footprintMeshes || !this.renderer) {
            return;
        }
        if (!this.currentObject.userData) return;
        this.renderer.clearStencil();
        const scaleUnit = this.currentObject.userData.scaleUnit;
        this.currentObject.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                const object_shadow = new MaplibreShadowMesh(child, 0x00e5ff, 1.0);
                object_shadow.userData = {
                    scale_unit: scaleUnit,
                };
                object_shadow.matrixAutoUpdate = false;
                this.scene?.add(object_shadow);
                this.footprintMeshes?.push(object_shadow);
            }
        });
    }

    attachGizmoToObject(object: THREE.Object3D): void {
        if (!this.currentTile || !this.renderer || !this.camera || !this.scene || !this.map) return;
        this.transformControl?.dispose();
        this.footprintMeshes = [];
        this.scene.clear();
        this.currentObject = object;
        this.enableLocalClippingPlane(this.current_local_enable_clipping_plane);
        this.addMeshFootPrint();
        this.showFootprint(this.show_footprint);
        if (!this.currentObject) {
            return;
        }
        this.transformControl = new MaplibreTransformControls(this.camera,
            this.renderer.domElement,
            this.map,
            this.applyGlobeMatrix);
        this.transformControl.setSize(1);
        this.transformControl.attach(object);
        this.objectTransformSnapShot = {
            position: object.position.clone(),
            scale: object.scale.clone(),
            quaternion: object.quaternion.clone()
        }
        this.setMode(this.current_mode);
        (this.transformControl as unknown as THREE.Object3D).visible = true;
        (this.transformControl as unknown as THREE.Object3D).name = 'TransformControls';
        this.transformControl.setCurrentTile(this.currentTile);
        this.scene.add(this.transformControl as unknown as THREE.Object3D);
        this.transformControl.onHover = (parameter: HoverParameter): void => {
            this.showToolTip(parameter);
        }
        this.transformControl.onNotHover = (): void => {
            this.hideToolTip();
        }
    }

    setMode(mode: TransformControlsMode): void {
        this.current_mode = mode;
        if (!this.transformControl || !this.currentObject) return;
        const scaleUnit = this.currentObject.userData.scaleUnit ?? 1;
        this.transformControl.setMode(mode);
        this.applyScaleTransformGizmo(scaleUnit);
        this.map?.triggerRepaint();
    }

    enableLocalClippingPlane(enable : boolean){
        this.current_local_enable_clipping_plane = enable;
        if(!this.currentObject){return;}
        objectEnableClippingPlaneZ(this.currentObject,this.current_local_enable_clipping_plane);
    }

    createToolTip(): void {
        this.hoverDiv = document.createElement('div');
        this.hoverDiv.style.position = 'absolute';
        this.hoverDiv.style.pointerEvents = 'none';
        this.hoverDiv.style.padding = '4px 6px';
        this.hoverDiv.style.background = 'rgba(0,0,0,0.7)';
        this.hoverDiv.style.color = 'white';
        this.hoverDiv.style.fontSize = '12px';
        this.hoverDiv.style.borderRadius = '4px';
        this.hoverDiv.style.whiteSpace = 'nowrap';
        this.hoverDiv.style.whiteSpace = 'pre-line';
        this.hoverDiv.style.display = 'none'; // ban đầu ẩn
        document.body.appendChild(this.hoverDiv);
    }

    onAdd(map: Map, gl: WebGLRenderingContext): void {
        this.map = map;
        this.camera = new THREE.PerspectiveCamera();
        this.camera.matrixAutoUpdate = false;
        this.scene = new THREE.Scene;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
        });
        this.renderer.autoClear = false;
    }

    onRemove(): void {
        this.renderer?.dispose();
        this.scene = null;
        this.renderer = null;
        this.camera = null;
        this.map = null;
    }

    updateFootPrintMatrix(): void {
        //Dir huong tu tren xuong duoi de lay huong'
        if (!this.scene) {
            return;
        }
        const dir = new THREE.Vector3(0, 0, 1);
        this.scene.traverse((child) => {
            if (child instanceof MaplibreShadowMesh) {
                const shadow_scale_z = child.userData.scale_unit;
                (child as MaplibreShadowMesh).update(new THREE.Vector3(dir.x, dir.y, -dir.z / shadow_scale_z));
            }
        });
    }

    render(): void {
        if (!this.map || !this.camera || !this.renderer || !this.visible || !this.transformControl) {
            return;
        }
        if (this.currentTile) {
            const tr = (this.map).transform;
            if (!tr?.getProjectionData) {
                return;
            }
            const projectionData = tr.getProjectionData({
                overscaledTileID: this.currentTile,
                applyGlobeMatrix: this.applyGlobeMatrix,
            });
            const tileMatrix = projectionData.mainMatrix;
            this.camera.projectionMatrix = new THREE.Matrix4().fromArray(tileMatrix);
            this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
            this.renderer.resetState();
            if (!this.scene) {
                return;
            }
            //update footprint mesh
            this.updateFootPrintMatrix();
            this.renderer.render(this.scene, this.camera);
        }
    }
}