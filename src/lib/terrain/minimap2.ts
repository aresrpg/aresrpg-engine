import { createFullscreenQuad } from '../helpers/fullscreen-quad';
import { clamp } from '../helpers/math';
import * as THREE from '../libs/three-usage';

import type { HeightmapAtlas } from './heightmap/atlas/heightmap-atlas';
import { TileGeometryStore } from './heightmap/gpu/tile-geometry-store';

type Parameters = {
    readonly heightmapAtlas: HeightmapAtlas;
    readonly arrowTexture: THREE.Texture;
    readonly compassTexture: THREE.Texture;
    readonly meshPrecision: number;
    readonly maxViewDistance: number;
};

enum EMinimapShape {
    SQUARE = 0,
    ROUND = 1,
}

class Minimap {
    private readonly heightmapAtlas: HeightmapAtlas;

    private readonly tileGeometryStore: TileGeometryStore;

    public centerWorld = new THREE.Vector2(0, 0);
    public orientation: number = 0;
    public viewDistance: number = 100;

    public readonly maxViewDistance: number;

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly compass: THREE.Mesh;

    private readonly texture: {
        readonly renderTarget: THREE.WebGLRenderTarget;
        readonly worldSize: number;
        readonly fullscreenQuad: THREE.Mesh;
        readonly copyAtlasMaterial: THREE.ShaderMaterial;
        readonly atlasTextureUniform: THREE.IUniform<THREE.Texture | null>;
        readonly updatePeriod: number;

        lastUpdateTimestamp: number | null;
        centerWorld: THREE.Vector2Like;
    };

    private readonly grid: {
        readonly mesh: THREE.Mesh;
        readonly material: THREE.ShaderMaterial;
        readonly shapeUniform: THREE.IUniform<number>;
        readonly playerPositionUvUniform: THREE.IUniform<THREE.Vector2>;
        readonly playerViewDistanceUvUniform: THREE.IUniform<number>;
    };

    public shape = EMinimapShape.ROUND;
    public readonly sizeInPixels = 512;
    public lockNorth: boolean = true;

    public constructor(params: Parameters) {
        this.heightmapAtlas = params.heightmapAtlas;

        this.maxViewDistance = params.maxViewDistance;

        this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
        this.camera.position.set(0, 2, 2).normalize().multiplyScalar(3);
        this.camera.lookAt(0, 0, 0);

        this.tileGeometryStore = new TileGeometryStore({ segmentsCount: params.meshPrecision - 1, altitude: { min: 0, max: 1 } });

        const marginFactor = 1.5;
        const textureWorldSize = marginFactor * 2 * params.maxViewDistance;
        const textureSize = textureWorldSize / params.heightmapAtlas.texelSizeInWorld;
        const fullscreenQuad = createFullscreenQuad('position');
        const atlasTextureUniform = { value: null };
        const copyAtlasMaterial = new THREE.RawShaderMaterial({
            glslVersion: '300 es',
            uniforms: { uAtlasTexture: atlasTextureUniform },
            vertexShader: `
            in vec2 position;

            out vec2 vUv;

            void main() {
                gl_Position = vec4(2.0 * position - 1.0, 0, 1);
                vUv = position;
            }
            `,
            fragmentShader: `
            precision mediump float;

            uniform sampler2D uAtlasTexture;

            in vec2 vUv;

            out vec4 fragColor;

            void main() {
                fragColor = texture(uAtlasTexture, vUv);
            }
            `,
            blending: THREE.NoBlending,
        });
        fullscreenQuad.material = copyAtlasMaterial;
        this.texture = {
            renderTarget: new THREE.WebGLRenderTarget(textureSize, textureSize, {
                depthBuffer: false,
            }),
            fullscreenQuad,
            copyAtlasMaterial,
            atlasTextureUniform,
            updatePeriod: 1000,
            worldSize: textureWorldSize,
            lastUpdateTimestamp: null,
            centerWorld: { x: 0, y: 0 },
        };

        params.arrowTexture.wrapS = THREE.ClampToEdgeWrapping;
        params.arrowTexture.wrapT = THREE.ClampToEdgeWrapping;

        this.scene = new THREE.Scene();
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 4);
        directionalLight.position.set(100, 100, -100);
        directionalLight.target.position.set(0, 0, 0);
        this.scene.add(directionalLight);

        const playerPositionUvUniform = { value: new THREE.Vector2() };
        const playerViewDistanceUvUniform = { value: 1 };
        const shapeUniform = { value: this.shape };

        const altitudeRange = this.heightmapAtlas.heightmap.altitude.max - this.heightmapAtlas.heightmap.altitude.min;

        const gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uShape: shapeUniform,
                uMapTexture: { value: this.texture.renderTarget.texture },
                uPlayerPositionUv: playerPositionUvUniform,
                uPlayerViewDistanceUv: playerViewDistanceUvUniform,
                uAmbient: { value: 0.7 },
                uLightDirection: { value: new THREE.Vector3(-1, -1, 1).normalize() },
                uDirectionalLightIntensity: { value: 1 },
            },
            vertexShader: `
            uniform sampler2D uMapTexture;
            uniform vec2 uPlayerPositionUv;
            uniform float uPlayerViewDistanceUv;

            varying vec2 vMeshUv;
            varying vec3 vViewPosition;
            varying vec3 vColor;

            void main() {
                vMeshUv = position.xz;
                
                float altitudeScale = ${altitudeRange / this.texture.worldSize} / uPlayerViewDistanceUv;

                vec2 uv = uPlayerPositionUv + uPlayerViewDistanceUv * 2.0 * (vMeshUv - 0.5);
                vec4 mapSample = texture(uMapTexture, uv);
                vColor = mapSample.rgb;
                float altitude = mapSample.a * altitudeScale;
                
                float playerAltitude = texture(uMapTexture, uPlayerPositionUv).a * altitudeScale;

                vec3 displacedPosition = position;
                displacedPosition.y += altitude;
                displacedPosition.y -= playerAltitude;

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

            varying vec2 vMeshUv;
            varying vec3 vViewPosition;
            varying vec3 vColor;

            void main() {
                if (uShape == ${EMinimapShape.ROUND}) {
                    if (length(vMeshUv - 0.5) >= 0.5) {
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
        const gridMesh = new THREE.Mesh(this.tileGeometryStore.getBaseTile(), gridMaterial);
        gridMesh.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.5));
        this.scene.add(gridMesh);

        this.grid = {
            mesh: gridMesh,
            material: gridMaterial,
            playerPositionUvUniform,
            playerViewDistanceUvUniform,
            shapeUniform,
        };

        const compassGeometry = new THREE.PlaneGeometry();
        compassGeometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        this.compass = new THREE.Mesh(compassGeometry, new THREE.MeshBasicMaterial({ map: params.compassTexture, alphaTest: 0.9 }));
        this.compass.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 2, 0));
        this.compass.applyMatrix4(new THREE.Matrix4().makeScale(0.2, 0.2, 0.2));
        this.scene.add(this.compass);
    }

    public render(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            autoClear: renderer.autoClear,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
            renderTarget: renderer.getRenderTarget(),
        };

        renderer.autoClear = false;
        renderer.sortObjects = false;

        if (this.texture.lastUpdateTimestamp === null) {
            renderer.setRenderTarget(this.texture.renderTarget);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true);
            this.texture.lastUpdateTimestamp = -Infinity;
        }

        const now = performance.now();
        if (now - this.texture.lastUpdateTimestamp > this.texture.updatePeriod) {
            renderer.setRenderTarget(this.texture.renderTarget);
            const textureViewDistance = 0.5 * this.texture.renderTarget.width * this.heightmapAtlas.texelSizeInWorld;
            const atlasRootFrom = {
                x: Math.floor((this.centerWorld.x - textureViewDistance) / this.heightmapAtlas.rootTileSizeInWorld),
                y: Math.floor((this.centerWorld.y - textureViewDistance) / this.heightmapAtlas.rootTileSizeInWorld),
            };
            const atlasRootTo = {
                x: Math.floor((this.centerWorld.x + textureViewDistance) / this.heightmapAtlas.rootTileSizeInWorld),
                y: Math.floor((this.centerWorld.y + textureViewDistance) / this.heightmapAtlas.rootTileSizeInWorld),
            };
            const atlasRootId = { x: 0, y: 0 };
            this.texture.centerWorld = { ...this.centerWorld };
            const textureCornerWorld = {
                x: this.texture.centerWorld.x - 0.5 * this.texture.worldSize,
                y: this.texture.centerWorld.y - 0.5 * this.texture.worldSize,
            };
            for (atlasRootId.y = atlasRootFrom.y; atlasRootId.y <= atlasRootTo.y; atlasRootId.y++) {
                for (atlasRootId.x = atlasRootFrom.x; atlasRootId.x <= atlasRootTo.x; atlasRootId.x++) {
                    const rootTileView = this.heightmapAtlas.getTileView({ nestingLevel: 0, ...atlasRootId });

                    const viewport = new THREE.Vector4(
                        (rootTileView.coords.world.origin.x - textureCornerWorld.x) / this.heightmapAtlas.texelSizeInWorld,
                        (rootTileView.coords.world.origin.y - textureCornerWorld.y) / this.heightmapAtlas.texelSizeInWorld,
                        this.heightmapAtlas.rootTileSizeInTexels,
                        this.heightmapAtlas.rootTileSizeInTexels
                    );
                    this.texture.atlasTextureUniform.value = rootTileView.texture;
                    this.texture.copyAtlasMaterial.uniformsNeedUpdate = true;
                    renderer.setViewport(viewport);
                    renderer.render(this.texture.fullscreenQuad, this.camera);
                }
            }
            this.texture.lastUpdateTimestamp = now;
        }

        renderer.clearDepth();
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setViewport(16, 16, this.sizeInPixels, this.sizeInPixels);

        this.grid.shapeUniform.value = this.shape;
        this.grid.playerPositionUvUniform.value.set(
            (this.centerWorld.x - 0.5 * (this.texture.centerWorld.x - this.texture.worldSize)) / this.texture.worldSize,
            (this.centerWorld.y - 0.5 * (this.texture.centerWorld.y - this.texture.worldSize)) / this.texture.worldSize
        );
        this.viewDistance = clamp(this.viewDistance, 1, this.maxViewDistance);
        this.grid.playerViewDistanceUvUniform.value = this.viewDistance / this.texture.worldSize;
        const rotation = this.lockNorth ? 0 : this.orientation;
        this.scene.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        renderer.render(this.scene, this.camera);

        renderer.autoClear = previousState.autoClear;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setViewport(previousState.viewport);
        renderer.sortObjects = previousState.sortObjects;
    }
}

export { EMinimapShape, Minimap };
