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
    public orientation: number = 0;

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly grid: THREE.Mesh;
    private readonly compass: THREE.Mesh;

    private readonly gridMaterial: THREE.ShaderMaterial;
    private readonly mapTextureUniform: THREE.IUniform<THREE.Texture | null>;
    private readonly shapeUniform: THREE.IUniform<number>;
    private readonly viewRadiusUniform: THREE.IUniform<number>;

    public shape = EMinimapShape.ROUND;
    public readonly sizeInPixels = 512;
    public lockNorth: boolean = true;

    public constructor(terrainViewer: TerrainViewer, arrowTexture: THREE.Texture, compassTexture: THREE.Texture) {
        this.terrainViewer = terrainViewer;

        this.camera = new THREE.PerspectiveCamera(30, 1, .1, 500);
        this.camera.position.set(0, 2, 2).normalize().multiplyScalar(3);
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
        this.mapTextureUniform = { value: null };
        this.viewRadiusUniform = { value: 100 };

        this.gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uShape: this.shapeUniform,
                uMapTexture: this.mapTextureUniform,
                uMapTextureSize: { value: 400 },
                uViewRadius: this.viewRadiusUniform,
                uAmbient: { value: 0.7 },
                uLightDirection: { value: new THREE.Vector3(-1, -1, 1).normalize() },
                uDirectionalLightIntensity: { value: 1 },
            },
            vertexShader: `
            uniform sampler2D uMapTexture;
            uniform float uMapTextureSize;
            uniform float uViewRadius;

            varying vec2 vUv;
            varying vec3 vViewPosition;
            varying vec3 vColor;

            void main() {
                vUv = position.xz;
                
                float scaling = uViewRadius / uMapTextureSize;
                vec2 sampleUv = uViewRadius / uMapTextureSize * (vUv - 0.5) + 0.5;
                vec4 mapSample = texture(uMapTexture, sampleUv);
                float altitude = mapSample.a / scaling;
                vColor = mapSample.rgb;

                vec3 displacedPosition = position;
                displacedPosition.y += 0.2 * altitude;

                vec4 mvPosition = modelViewMatrix * vec4( displacedPosition, 1.0 );
                vViewPosition = - mvPosition.xyz; // vector from vertex to camera

                gl_Position = projectionMatrix * mvPosition;
            }
            `,
            fragmentShader: `
            uniform int uShape;
            uniform float uAmbient;
            uniform vec3 uLightDirection;
            uniform float uDirectionalLightIntensity;

            varying vec2 vUv;
            varying vec3 vViewPosition;
            varying vec3 vColor;

            void main() {
                if (uShape == ${EMinimapShape.ROUND}) {
                    if (length(vUv - 0.5) >= 0.5) {
                        discard;
                    }
                }

                vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));

                float light = uAmbient + uDirectionalLightIntensity * (0.5 + 0.5 * dot(normal, -uLightDirection));

                gl_FragColor = vec4(vColor * light, 1);
            }
            `,
            // wireframe: true,
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
        this.viewRadius = 100;
    }

    public setCenter(center: THREE.Vector2Like): void {
        this.centerOnWorld.set(center.x, 0, center.y);
    }

    public get viewRadius(): number {
        return this.viewRadiusUniform.value;
    }

    public set viewRadius(radius: number) {
        this.viewRadiusUniform.value = radius;
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

        this.shapeUniform.value = this.shape;
        this.mapTextureUniform.value = (window as any).rootTexture;
        const rotation = this.lockNorth ? 0 : this.orientation;
        this.scene.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        renderer.render(this.scene, this.camera);

        renderer.sortObjects = previousState.sortObjects;
        renderer.autoClear = previousState.autoClear;
        renderer.setViewport(previousState.viewport);
    }
}

export {
    EMinimapShape,
    Minimap
};

