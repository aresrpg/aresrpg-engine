import { createFullscreenQuad } from '../../../helpers/fullscreen-quad';
import { clamp } from '../../../helpers/math';
import * as THREE from '../../../libs/three-usage';
import { type WaterData } from '../../water/water-data';
import type { HeightmapAtlas } from '../atlas/heightmap-atlas';

type Parameters = {
    readonly heightmapAtlas: HeightmapAtlas;
    readonly compassTexture?: THREE.Texture;
    readonly waterData?: WaterData;
    readonly meshPrecision: number;
    readonly minViewDistance: number;
    readonly maxViewDistance: number;
    readonly markersSize: number;
};

type MinimapMarker = {
    worldPosition: THREE.Vector3;
    readonly object3D: THREE.Object3D;
    dispose(): void;
};

class Minimap {
    private readonly heightmapAtlas: HeightmapAtlas;

    public centerPosition = new THREE.Vector3(0, 0, 0);
    public verticalAngle: number = Math.PI / 4;
    public orientation: number = 0;
    public viewDistance: number = 100;
    public altitudeScaling: number = 1;
    public maxHeight: number = 0.4;
    public lockNorth: boolean = false;
    public crustThickness: number = 0.05;
    public screenPosition = new THREE.Vector2(16, 16);
    public screenSize: number = 512;

    public readonly minViewDistance: number;
    public readonly maxViewDistance: number;

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly compass: THREE.Mesh | null = null;

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
        readonly uniforms: {
            readonly uPlayerPositionUv: THREE.IUniform<THREE.Vector2>;
            readonly uPlayerViewDistanceUv: THREE.IUniform<number>;
            readonly uPlayerAltitude: THREE.IUniform<number>;
            readonly uAltitudeScaling: THREE.IUniform<number>;
            readonly uMaxHeight: THREE.IUniform<number>;
            readonly uCrustThickness: THREE.IUniform<number>;
        };
    };

    private readonly water: {
        readonly waterMesh: THREE.Mesh;
        readonly waterMaterial: THREE.ShaderMaterial;
        readonly uniforms: {
            readonly uWaterLevel: THREE.IUniform<number>;
            readonly uWaterLevelBottom: THREE.IUniform<number>;
            readonly uWaterLevelTop: THREE.IUniform<number>;
            readonly uWaterUvFrom: THREE.IUniform<THREE.Vector2>;
            readonly uWaterUvTo: THREE.IUniform<THREE.Vector2>;
            readonly uPlayerPositionUv: THREE.IUniform<THREE.Vector2>;
            readonly uPlayerViewDistanceUv: THREE.IUniform<number>;
        };
        readonly data: WaterData;
    } | null = null;

    private readonly markers: {
        readonly size: number;
        readonly map: Map<string, MinimapMarker>;
    };

    public constructor(params: Parameters) {
        this.heightmapAtlas = params.heightmapAtlas;

        this.minViewDistance = params.minViewDistance;
        this.maxViewDistance = params.maxViewDistance;

        this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);

        this.markers = {
            size: params.markersSize,
            map: new Map(),
        };
        const marginFactor = 1.5;
        const textureSize = Math.ceil((marginFactor * 2 * params.maxViewDistance) / params.heightmapAtlas.texelSizeInWorld);
        const textureWorldSize = textureSize * params.heightmapAtlas.texelSizeInWorld;

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

        this.scene = new THREE.Scene();
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 4);
        directionalLight.position.set(100, 100, -100);
        directionalLight.target.position.set(0, 0, 0);
        this.scene.add(directionalLight);

        const gridUniforms = {
            uPlayerPositionUv: { value: new THREE.Vector2() },
            uPlayerViewDistanceUv: { value: 1 },
            uPlayerAltitude: { value: this.centerPosition.y },
            uAltitudeScaling: { value: this.altitudeScaling },
            uMaxHeight: { value: this.maxHeight },
            uCrustThickness: { value: this.crustThickness },
        };

        const gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uMapTexture: { value: this.texture.renderTarget.texture },
                uAmbient: { value: 0.7 },
                uLightDirection: { value: new THREE.Vector3(-1, -1, 1).normalize() },
                uDirectionalLightIntensity: { value: 1 },
                ...gridUniforms,
            },
            vertexShader: `
            uniform sampler2D uMapTexture;
            uniform vec2 uPlayerPositionUv;
            uniform float uPlayerViewDistanceUv;
            uniform float uPlayerAltitude;
            uniform float uMaxHeight;
            uniform float uAltitudeScaling;
            uniform float uCrustThickness;

            varying vec3 vViewPosition;
            varying vec2 vUv;

            void main() {
                vec3 adjustedPosition = position;
                vec2 rawUv = position.xz;
                float isOnEdge = float(rawUv.x < 0.0 || rawUv.y < 0.0 || rawUv.x > 1.0 || rawUv.y > 1.0);

                adjustedPosition.xz = clamp(adjustedPosition.xz, vec2(0.0), vec2(1.0));
                vec2 adjustedUv = adjustedPosition.xz;

                vUv = uPlayerPositionUv + uPlayerViewDistanceUv * 2.0 * (adjustedUv - 0.5);
                vec4 mapSample = texture(uMapTexture, vUv);
 
                float altitude = mix(
                    ${this.heightmapAtlas.heightmap.altitude.min.toFixed(1)}, 
                    ${this.heightmapAtlas.heightmap.altitude.max.toFixed(1)},
                    mapSample.a
                );
                altitude -= uPlayerAltitude;
                altitude /= ${this.texture.worldSize.toFixed(1)} * uPlayerViewDistanceUv;
                altitude *= .5 * uAltitudeScaling;

                adjustedPosition.y += altitude;
                adjustedPosition.y = clamp(adjustedPosition.y, -0.5 * uMaxHeight, 0.5 * uMaxHeight);
                adjustedPosition.y -= uCrustThickness * isOnEdge;

                vec4 mvPosition = modelViewMatrix * vec4(adjustedPosition, 1.0);
                vViewPosition = -mvPosition.xyz;

                gl_Position = projectionMatrix * mvPosition;
            }
            `,
            fragmentShader: `
            uniform float uAmbient;
            uniform vec3 uLightDirection;
            uniform float uDirectionalLightIntensity;
            uniform sampler2D uMapTexture;

            varying vec3 vViewPosition;
            varying vec2 vUv;

            void main() {
                vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));

                float light = uAmbient + uDirectionalLightIntensity * (0.5 + 0.5 * dot(normal, -uLightDirection));

                vec3 color = texture(uMapTexture, vUv).rgb;
                gl_FragColor = vec4(color * light, 1);
            }
            `,
            // wireframe: true,
        });

        const gridPositions: number[] = [];
        for (let iZ = -1; iZ <= params.meshPrecision; iZ++) {
            for (let iX = -1; iX <= params.meshPrecision; iX++) {
                gridPositions.push(iX / (params.meshPrecision - 1), 0, iZ / (params.meshPrecision - 1));
            }
        }
        const buildIndex = (x: number, z: number): number => {
            if (x < -1 || z < -1 || x > params.meshPrecision || z > params.meshPrecision) {
                throw new Error();
            }
            return x + 1 + (z + 1) * (params.meshPrecision + 2);
        };
        const gridIndices: number[] = [];
        for (let iZ = -1; iZ < params.meshPrecision; iZ++) {
            for (let iX = -1; iX < params.meshPrecision; iX++) {
                const i00 = buildIndex(iX, iZ);
                const i10 = buildIndex(iX + 1, iZ);
                const i01 = buildIndex(iX, iZ + 1);
                const i11 = buildIndex(iX + 1, iZ + 1);
                gridIndices.push(i00, i11, i10, i00, i01, i11);
            }
        }
        const gridBufferGeometry = new THREE.BufferGeometry();
        gridBufferGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
        gridBufferGeometry.setIndex(gridIndices);

        const gridMesh = new THREE.Mesh(gridBufferGeometry, gridMaterial);
        gridMesh.applyMatrix4(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.5));
        this.scene.add(gridMesh);
        this.grid = {
            mesh: gridMesh,
            material: gridMaterial,
            uniforms: gridUniforms,
        };

        if (params.waterData) {
            const waterMaterialUniforms = {
                uWaterLevel: { value: params.waterData.map.waterLevel },
                uWaterLevelBottom: { value: 0 },
                uWaterLevelTop: { value: 0 },
                uWaterUvFrom: { value: new THREE.Vector2() },
                uWaterUvTo: { value: new THREE.Vector2() },
                uMaxHeight: gridUniforms.uMaxHeight,
                uPlayerPositionUv: gridUniforms.uPlayerPositionUv,
                uPlayerViewDistanceUv: gridUniforms.uPlayerViewDistanceUv,
                uMapTexture: { value: this.texture.renderTarget.texture },
                uAmbient: { value: 0.5 },
                uLightDirection: { value: new THREE.Vector3(-1, -3, 0.7).normalize() },
                uDirectionalLightIntensity: { value: 0.75 },
                uWaterTexture: { value: params.waterData.texture },
            };

            const waterMaterial = new THREE.ShaderMaterial({
                glslVersion: '300 es',
                uniforms: waterMaterialUniforms,
                vertexShader: `                
                uniform vec2 uPlayerPositionUv;
                uniform float uPlayerViewDistanceUv;
                uniform float uWaterLevel;
                uniform float uWaterLevelBottom;
                uniform float uWaterLevelTop;
                uniform vec2 uWaterUvFrom;
                uniform vec2 uWaterUvTo;
                uniform float uAmbient;
                uniform vec3 uLightDirection;
                uniform float uDirectionalLightIntensity;

                out vec2 vWaterUv;
                out vec2 vUv;
                out float vAltitudeWorld;
                out float vLight;
                out float vY;

                void main() {
                    gl_Position = modelMatrix * vec4(position, 1);
                    vY = gl_Position.y;
                    gl_Position = projectionMatrix * viewMatrix * gl_Position;

                    vUv = position.xz + 0.5;
                    vUv = uPlayerPositionUv + uPlayerViewDistanceUv * 2.0 * (vUv - 0.5);

                    if (normal.y > 0.0) {
                        vAltitudeWorld = uWaterLevel;
                    } else {
                        vAltitudeWorld = mix(uWaterLevelTop, uWaterLevelBottom, -position.y);
                    }

                    vLight = uAmbient + uDirectionalLightIntensity * (0.5 + 0.5 * dot(normal, -uLightDirection));

                    vWaterUv = mix(uWaterUvFrom, uWaterUvTo, position.xz + 0.5);
                }`,
                fragmentShader: `
                precision mediump float;

                uniform sampler2D uMapTexture;
                uniform sampler2D uWaterTexture;
                uniform float uMaxHeight;
                
                in vec2 vWaterUv;
                in vec2 vUv;
                in float vAltitudeWorld;
                in float vLight;
                in float vY;

                out vec4 fragColor;

                void main() {
                    float terrainAltitude = mix(
                        ${this.heightmapAtlas.heightmap.altitude.min.toFixed(1)}, 
                        ${this.heightmapAtlas.heightmap.altitude.max.toFixed(1)},
                        texture(uMapTexture, vUv).a
                    );
                    if (vAltitudeWorld < terrainAltitude) {
                        discard;
                    }
                    if (vY < -0.5 * uMaxHeight) {
                        discard;
                    }

                    vec3 color = texture(uWaterTexture, vWaterUv).rgb;
                    color *= vLight;
                    fragColor = vec4(color, 0.75);
                }
                `,
                transparent: true,
                depthWrite: false,
                depthFunc: THREE.LessEqualDepth,
            });

            const waterMesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1, 1.001), waterMaterial);
            waterMesh.geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -0.5, 0));
            this.water = { waterMesh, waterMaterial, data: params.waterData, uniforms: waterMaterialUniforms };
            this.scene.add(this.water.waterMesh);
        }

        if (params.compassTexture) {
            const compassGeometry = new THREE.PlaneGeometry();
            compassGeometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
            this.compass = new THREE.Mesh(compassGeometry, new THREE.MeshBasicMaterial({ map: params.compassTexture, alphaTest: 0.9 }));
            this.compass.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 2, 0));
            this.compass.applyMatrix4(new THREE.Matrix4().makeScale(0.2, 0.2, 0.2));
            this.scene.add(this.compass);
        }
    }

    public update(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            autoClear: renderer.autoClear,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
            renderTarget: renderer.getRenderTarget(),
        };

        if (this.texture.lastUpdateTimestamp === null) {
            renderer.setRenderTarget(this.texture.renderTarget);
            renderer.setClearColor(0x000000, 0);
            renderer.clear(true);
            this.texture.lastUpdateTimestamp = -Infinity;
        }

        const now = performance.now();
        if (now - this.texture.lastUpdateTimestamp > this.texture.updatePeriod) {
            this.texture.centerWorld = { x: this.centerPosition.x, y: this.centerPosition.z };
            this.requestDataFromAtlas();
            this.copyAtlasToLocalTexture(renderer);
            this.texture.lastUpdateTimestamp = now;
        }

        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setViewport(previousState.viewport);
        renderer.autoClear = previousState.autoClear;
        renderer.sortObjects = previousState.sortObjects;
    }

    public render(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            autoClear: renderer.autoClear,
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
            renderTarget: renderer.getRenderTarget(),
        };

        renderer.autoClear = false;
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.clearDepth();
        renderer.setViewport(this.screenPosition.x, this.screenPosition.y, this.screenSize, this.screenSize);

        this.camera.position.copy(new THREE.Vector3().setFromSphericalCoords(3, this.verticalAngle, 0));
        this.camera.lookAt(0, 0, 0);

        const rotation = this.lockNorth ? 0 : this.orientation;

        if (this.compass) {
            this.compass.position.y = 0.2;
        }

        const convertToLocalY = (worldY: number) =>
            clamp(
                0.5 * ((worldY - this.centerPosition.y) / this.viewDistance) * this.altitudeScaling,
                -0.5 * this.maxHeight,
                0.5 * this.maxHeight
            );
        const convertToWorldY = (localY: number) => (2 * this.viewDistance * localY) / this.altitudeScaling + this.centerPosition.y;

        if (this.markers.size > 0) {
            for (const marker of this.markers.map.values()) {
                const localPosition = {
                    x: (marker.worldPosition.x - (this.centerPosition.x - this.viewDistance)) / (2 * this.viewDistance) - 0.5,
                    y: convertToLocalY(marker.worldPosition.y),
                    z: (marker.worldPosition.z - (this.centerPosition.z - this.viewDistance)) / (2 * this.viewDistance) - 0.5,
                };
                if (localPosition.x < -0.5 || localPosition.x > 0.5 || localPosition.z < -0.5 || localPosition.z > 0.5) {
                    marker.object3D.removeFromParent();
                } else {
                    marker.object3D.position.copy(localPosition);
                    this.scene.add(marker.object3D);
                }
            }
        }

        if (this.water) {
            this.water.waterMesh.position.y = convertToLocalY(this.water.data.map.waterLevel) + 0.001;
            this.water.uniforms.uWaterLevel.value = this.water.data.map.waterLevel;
            this.water.uniforms.uWaterLevelTop.value = convertToWorldY(this.water.waterMesh.position.y);
            this.water.uniforms.uWaterLevelBottom.value = convertToWorldY(this.water.waterMesh.position.y - 1);

            const waterOriginPatch = this.water.data.getWaterOriginPatch();
            this.water.uniforms.uWaterUvFrom.value.set(
                ((this.centerPosition.x - this.viewDistance) / this.water.data.patchSize - waterOriginPatch.x) /
                    this.water.data.patchesCount,
                ((this.centerPosition.z - this.viewDistance) / this.water.data.patchSize - waterOriginPatch.y) /
                    this.water.data.patchesCount
            );
            this.water.uniforms.uWaterUvTo.value.set(
                ((this.centerPosition.x + this.viewDistance) / this.water.data.patchSize - waterOriginPatch.x) /
                    this.water.data.patchesCount,
                ((this.centerPosition.z + this.viewDistance) / this.water.data.patchSize - waterOriginPatch.y) /
                    this.water.data.patchesCount
            );
        }

        this.grid.uniforms.uPlayerPositionUv.value.set(
            (this.centerPosition.x - this.texture.centerWorld.x) / this.texture.worldSize + 0.5,
            (this.centerPosition.z - this.texture.centerWorld.y) / this.texture.worldSize + 0.5
        );
        this.viewDistance = clamp(this.viewDistance, this.minViewDistance, this.maxViewDistance);
        this.grid.uniforms.uPlayerViewDistanceUv.value = this.viewDistance / this.texture.worldSize;
        this.grid.uniforms.uPlayerAltitude.value = this.centerPosition.y;
        this.grid.uniforms.uAltitudeScaling.value = this.altitudeScaling;
        this.grid.uniforms.uMaxHeight.value = this.maxHeight;
        this.grid.uniforms.uCrustThickness.value = this.crustThickness;
        this.scene.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        renderer.render(this.scene, this.camera);

        renderer.autoClear = previousState.autoClear;
        renderer.setViewport(previousState.viewport);
        renderer.sortObjects = previousState.sortObjects;
    }

    public setMarker(name: string, worldPosition: THREE.Vector3): void {
        let marker = this.markers.map.get(name);
        if (!marker) {
            const geometry = new THREE.SphereGeometry(this.markers.size, 12, 12);
            const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
            const ball = new THREE.Mesh(geometry, material);

            marker = {
                worldPosition: worldPosition.clone(),
                object3D: ball,
                dispose(): void {
                    geometry.dispose();
                    material.dispose();
                },
            };
            this.markers.map.set(name, marker);
        }
        marker.worldPosition.copy(worldPosition);
    }

    public deleteMarker(name: string): void {
        const marker = this.markers.map.get(name);
        if (marker) {
            marker.dispose();
            marker.object3D.removeFromParent();
            this.markers.map.delete(name);
        }
    }

    private requestDataFromAtlas(): void {
        const textureCornerWorld = this.textureCornerWorld;

        const atlasLeafFrom = textureCornerWorld.clone().divideScalar(this.heightmapAtlas.leafTileSizeInWorld).floor();
        const atlasLeafTo = textureCornerWorld
            .clone()
            .addScalar(this.texture.worldSize)
            .divideScalar(this.heightmapAtlas.leafTileSizeInWorld)
            .floor();
        const atlasLeafId = { x: 0, y: 0 };
        for (atlasLeafId.y = atlasLeafFrom.y; atlasLeafId.y <= atlasLeafTo.y; atlasLeafId.y++) {
            for (atlasLeafId.x = atlasLeafFrom.x; atlasLeafId.x <= atlasLeafTo.x; atlasLeafId.x++) {
                const leafView = this.heightmapAtlas.getTileView({
                    nestingLevel: this.heightmapAtlas.maxNestingLevel,
                    ...atlasLeafId,
                });
                if (!leafView.hasOptimalData()) {
                    leafView.requestData();
                }
            }
        }
    }

    private copyAtlasToLocalTexture(renderer: THREE.WebGLRenderer): void {
        const textureCornerWorld = this.textureCornerWorld;

        renderer.autoClear = false;
        renderer.sortObjects = false;

        renderer.setRenderTarget(this.texture.renderTarget);

        const atlasRootFrom = textureCornerWorld.clone().divideScalar(this.heightmapAtlas.rootTileSizeInWorld).floor();
        const atlasRootTo = textureCornerWorld
            .clone()
            .addScalar(this.texture.worldSize)
            .divideScalar(this.heightmapAtlas.rootTileSizeInWorld)
            .floor();
        const atlasRootId = { x: 0, y: 0 };
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
    }

    private get textureCornerWorld(): THREE.Vector2 {
        return new THREE.Vector2().copy(this.texture.centerWorld).subScalar(0.5 * this.texture.worldSize);
    }
}

export { Minimap };
