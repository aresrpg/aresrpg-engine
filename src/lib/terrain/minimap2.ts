import * as THREE from "../libs/three-usage";

import { TileGeometryStore } from "./heightmap/gpu/meshes/tile-geometry-store";
import type { TerrainViewer } from "./terrain-viewer";

enum EMinimapShape {
    SQUARE = 0,
    ROUND = 1,
}

class Minimap {
    private readonly terrainViewer: TerrainViewer;

    private readonly tileGeometryStore: TileGeometryStore;

    private readonly centerOnWorld = new THREE.Vector3(0, 0, 0);
    private worldSize: number = 100
    public orientation: number = 0;

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly grid: THREE.Mesh;
    private readonly compass: THREE.Mesh;

    private readonly gridMaterial: THREE.ShaderMaterial;
    private readonly shapeUniform: THREE.IUniform<number>;

    public shape = EMinimapShape.SQUARE;
    public readonly sizeInPixels = 512;
    public lockNorth: boolean = true;

    public constructor(terrainViewer: TerrainViewer, arrowTexture: THREE.Texture, compassTexture: THREE.Texture) {
        this.terrainViewer = terrainViewer;

        this.camera = new THREE.PerspectiveCamera(30, 1, .1, 500);
        this.camera.position.set(2, 2, 2);
        this.camera.lookAt(0, 0, 0);

        this.tileGeometryStore = new TileGeometryStore({ segmentsCount: 63, altitude: { min: 0, max: 1 } });

        arrowTexture.wrapS = THREE.ClampToEdgeWrapping;
        arrowTexture.wrapT = THREE.ClampToEdgeWrapping;

        this.scene = new THREE.Scene();
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 4);
        directionalLight.position.set(100, 100, -100);
        directionalLight.target.position.set(0, 0, 0);
        this.scene.add(directionalLight);

        this.shapeUniform = { value: this.shape };
        this.gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uShape: this.shapeUniform,
            },
            vertexShader: `
            varying vec2 vUv;

            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
                vUv = position.xz;
            }
            `,
            fragmentShader: `
            uniform int uShape;

            varying vec2 vUv;

            void main() {
                if (uShape == ${EMinimapShape.ROUND}) {
                    if (length(vUv - 0.5) >= 0.5) {
                        discard;
                    }
                }

                gl_FragColor = vec4(vUv, 0, 1);
            }
            `,
            wireframe: true,
        });
        this.grid = new THREE.Mesh(this.tileGeometryStore.getBaseTile(), this.gridMaterial);
        this.grid.applyMatrix4(new THREE.Matrix4().makeTranslation(-.5, 0, -.5));
        this.scene.add(this.grid);

        const compassGeometry = new THREE.PlaneGeometry();
        compassGeometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        this.compass = new THREE.Mesh(compassGeometry, new THREE.MeshBasicMaterial({ map: compassTexture, alphaTest: 0.9 }));
        this.compass.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 2, 0));
        this.compass.applyMatrix4(new THREE.Matrix4().makeScale(0.2, 0.2, 0.2));
        this.scene.add(this.compass);

        this.setCenter({ x: 0, y: 0 });
        this.radius = 100;
    }

    public setCenter(center: THREE.Vector2Like): void {
        this.centerOnWorld.set(center.x, 0, center.y);
    }

    public get radius(): number {
        return this.worldSize;
    }

    public set radius(radius: number) {
        this.worldSize = radius;
    }

    public render(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            autoClear: renderer.autoClear,
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
            terrainViewerParent: this.terrainViewer.container.parent,
        };

        renderer.autoClear = false;

        renderer.clearDepth();
        renderer.setViewport(16, 16, this.sizeInPixels, this.sizeInPixels);

        this.scene.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), this.orientation);
        renderer.render(this.scene, this.camera);

        renderer.sortObjects = previousState.sortObjects;
        renderer.autoClear = previousState.autoClear;
        renderer.setViewport(previousState.viewport);
    }
}

export {
    Minimap
};

