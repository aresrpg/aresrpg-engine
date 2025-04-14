import { createFullscreenQuad } from '../../../helpers/fullscreen-quad';
import { logger } from '../../../helpers/logger';
import { safeModulo } from '../../../helpers/math';
import { setViewportInvariantVec4, setViewportWholeRendertarget } from '../../../helpers/misc';
import * as THREE from '../../../libs/three-usage';
import type { MaterialsStore } from '../../materials-store';
import type { HeightmapSamples } from '../i-heightmap';

type Parameters = {
    readonly altitude: {
        readonly min: number;
        readonly max: number;
    };
    readonly materialsStore: MaterialsStore;
    readonly texelSizeInWorld: number;
    readonly leafTileSizeInWorld: number;
    readonly maxTextureSize?: number;
    readonly maintainanceInterval?: number;
};

type HeightmapAtlasStatistics = {
    rootNodesCount: number;
    rootNodeTextureSize: number;
    totalGpuMemoryBytes: number;
};

type AtlasTexture = {
    readonly renderTarget: THREE.WebGLRenderTarget;
    readonly texture: THREE.Texture;
    hasBeenClearedOnce: boolean;
    isStub: boolean;
    readonly dataPerLeafTile: Map<string, number>;
};

type AtlasTileLocalInfos = {
    rootTexture: AtlasTexture;
    textureUv: THREE.Vector4;
    viewportWorld: THREE.Vector4;
    fromLeaf: THREE.Vector2Like;
    toLeaf: THREE.Vector2Like;
};

type TilePendingResponse = {
    readonly tileId: AtlasTileId;
    readonly requestId: symbol;
    readonly state: 'pending-response';
};
type TilePendingApplication = {
    readonly tileId: AtlasTileId;
    readonly state: 'pending-application';
    readonly heightmapSamples: HeightmapSamples;
};
type PendingUpdate = TilePendingResponse | TilePendingApplication;

type AtlasTileId = {
    readonly nestingLevel: number; // 0: the whole texture, 1: a quarter, etc.
    readonly x: number; // level-relative world ID
    readonly y: number; // level-relative world ID
};

type HeightmapAtlasTileView = {
    readonly tileId: AtlasTileId;
    readonly texture: THREE.Texture;
    readonly coords: {
        readonly uv: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
        readonly world: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
    };
    hasBasicData(): boolean;
    stopUsingView(): void;
    useOptimalData(): void;
    stopUsingOptimalData(): void;
};

type TileUsage = {
    readonly tileId: AtlasTileId;
    readonly texture: THREE.Texture;
    readonly coords: {
        readonly uv: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
        readonly world: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
    };
    readonly users: Set<symbol>;
    readonly optimalDataUsers: Set<symbol>;
    hasOptimalData: boolean;
};

class HeightmapAtlas {
    public readonly altitude: {
        readonly min: number;
        readonly max: number;
    };

    public readonly texelSizeInWorld: number;

    public readonly rootTileSizeInTexels: number;
    public readonly rootTileSizeInWorld: number;

    public readonly leafTileSizeInWorld: number;
    public readonly leafTileSizeInTexels: number;

    public readonly maxNestingLevel: number;

    private readonly maintainanceInterval: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly fullscreenQuad: THREE.Mesh;

    protected readonly normalizedPositions: Float32Array;

    private readonly copyTexture: {
        readonly material: THREE.Material;
        readonly renderTarget: THREE.WebGLRenderTarget;
        readonly textureUniform: THREE.IUniform<THREE.Texture | null>;
    };

    private readonly dataConversion: {
        readonly material: THREE.Material;
        readonly renderTarget: THREE.WebGLRenderTarget;
        readonly altitudeTexture: THREE.DataTexture;
        readonly altitudeBuffer: Float32Array;
        readonly materialIdTexture: THREE.DataTexture;
        readonly materialIdBuffer: Uint32Array;
    };

    private readonly tileStorage: {
        readonly material: THREE.Material;
        readonly uniforms: {
            readonly uNestingLevel: THREE.IUniform<number>;
        };
    };

    private readonly tilesUsage = new Map<string, TileUsage>();

    protected readonly pendingUpdates = new Map<string, PendingUpdate>();
    private lastMaintainanceTimestamp: number | null = null;

    private readonly rootTextures = new Map<string, AtlasTexture>();

    public constructor(params: Parameters) {
        const leafTileSizeInTexels = params.leafTileSizeInWorld / params.texelSizeInWorld;
        if (!Number.isInteger(leafTileSizeInTexels)) {
            throw new Error(`Invalid parameters ${JSON.stringify(params)}`);
        }

        const maxTextureSize = params.maxTextureSize ?? 1024;
        const maxNestingLevel = Math.floor(Math.log2(maxTextureSize / leafTileSizeInTexels));
        const rootTileSizeInTexels = leafTileSizeInTexels * 2 ** maxNestingLevel;
        if (rootTileSizeInTexels > maxTextureSize) {
            throw new Error();
        }

        this.altitude = { ...params.altitude };

        this.maintainanceInterval = params.maintainanceInterval ?? 500;

        this.texelSizeInWorld = params.texelSizeInWorld;

        this.rootTileSizeInTexels = rootTileSizeInTexels;
        this.rootTileSizeInWorld = this.rootTileSizeInTexels * this.texelSizeInWorld;

        this.leafTileSizeInTexels = leafTileSizeInTexels;
        this.leafTileSizeInWorld = params.leafTileSizeInWorld;

        this.maxNestingLevel = maxNestingLevel;

        const normalizedPositions: number[] = [];
        for (let iY = 0; iY < this.leafTileSizeInTexels; iY++) {
            for (let iX = 0; iX < this.leafTileSizeInTexels; iX++) {
                normalizedPositions.push(iX / (this.leafTileSizeInTexels - 1), iY / (this.leafTileSizeInTexels - 1));
            }
        }
        this.normalizedPositions = new Float32Array(normalizedPositions);

        this.fullscreenQuad = createFullscreenQuad('position');

        const altitudeBuffer = new Float32Array(this.leafTileSizeInTexels * this.leafTileSizeInTexels);
        const altitudeTexture = new THREE.DataTexture(
            altitudeBuffer,
            this.leafTileSizeInTexels,
            this.leafTileSizeInTexels,
            THREE.RedFormat,
            THREE.FloatType
        );
        const materialIdBuffer = new Uint32Array(this.leafTileSizeInTexels * this.leafTileSizeInTexels);
        const materialIdTexture = new THREE.DataTexture(
            materialIdBuffer,
            this.leafTileSizeInTexels,
            this.leafTileSizeInTexels,
            THREE.RedIntegerFormat,
            THREE.UnsignedIntType
        );

        this.dataConversion = {
            material: new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    uAltitudeTexture: { value: altitudeTexture },
                    uMaterialIdTexture: { value: materialIdTexture },
                    uMaterialsTexture: { value: params.materialsStore.texture },
                },
                blending: THREE.NoBlending,
                depthTest: false,
                depthWrite: false,
                vertexShader: `
                in vec2 position;
                out vec2 vUv;

                void main() {
                    gl_Position = vec4(2.0 * position - 1.0, 0, 1);
                    vUv = position;
                }`,
                fragmentShader: `
                precision mediump float;

                uniform sampler2D uAltitudeTexture;
                uniform highp usampler2D uMaterialIdTexture;
                uniform sampler2D uMaterialsTexture;

                in vec2 vUv;

                out vec4 fragColor;

                ${params.materialsStore.glslDeclaration}

                void main() {
                    ivec2 texelId = ivec2(gl_FragCoord);
                    uint materialId = texelFetch(uMaterialIdTexture, texelId, 0).r;
                    vec3 color = getVoxelColor(materialId, uMaterialsTexture);

                    float altitude = texelFetch(uAltitudeTexture, texelId, 0).r;
                    const float minAltitude = ${params.altitude.min.toFixed(1)};
                    const float maxAltitude = ${params.altitude.max.toFixed(1)};
                    float normalizedAltitude = (altitude - minAltitude) / (maxAltitude - minAltitude);

                    fragColor = vec4(color, normalizedAltitude);
                }
                `,
            }),
            renderTarget: new THREE.WebGLRenderTarget(this.leafTileSizeInTexels, this.leafTileSizeInTexels, {
                generateMipmaps: false,
                depthBuffer: false,
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
            }),
            altitudeTexture,
            altitudeBuffer,
            materialIdTexture,
            materialIdBuffer,
        };

        const tileStorageUniforms = {
            uNestingLevel: { value: 0 },
        };
        this.tileStorage = {
            material: new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    ...tileStorageUniforms,
                    uTileTexture: { value: this.dataConversion.renderTarget.texture },
                },
                vertexShader: `
                uniform float uLevelUniform;
    
                in vec2 position;
                out vec2 vUv;
    
                void main() {
                    gl_Position = vec4(2.0 * position - 1.0, uLevelUniform / ${(maxNestingLevel + 1).toFixed(1)}, 1);
                    vUv = position;
                }
                `,
                fragmentShader: `
                precision mediump float;
    
                uniform sampler2D uTileTexture;
    
                in vec2 vUv;
    
                out vec4 fragColor;
    
                void main() {
                    fragColor = texture(uTileTexture, vUv);
                }
                `,
                blending: THREE.NoBlending,
            }),
            uniforms: tileStorageUniforms,
        };

        const textureExpansionUniform = { value: null };
        this.copyTexture = {
            renderTarget: new THREE.WebGLRenderTarget(this.leafTileSizeInTexels, this.leafTileSizeInTexels, {
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                generateMipmaps: false,
                depthBuffer: false,
                colorSpace: THREE.LinearSRGBColorSpace,
            }),
            material: new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    uTexture: textureExpansionUniform,
                },
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

                uniform sampler2D uTexture;

                in vec2 vUv;

                out vec4 fragColor;

                void main() {
                    fragColor = texture(uTexture, vUv);
                }
                `,
                blending: THREE.NoBlending,
            }),
            textureUniform: textureExpansionUniform,
        };
    }

    public update(renderer: THREE.WebGLRenderer): void {
        const now = performance.now();
        if (this.lastMaintainanceTimestamp === null || now - this.lastMaintainanceTimestamp > this.maintainanceInterval) {
            this.deleteUnusedTilesUsage();
            this.lastMaintainanceTimestamp = now;
        }

        const pendingApplications: [string, TilePendingApplication][] = [];
        for (const [updateId, update] of this.pendingUpdates.entries()) {
            if (update.state === 'pending-application') {
                pendingApplications.push([updateId, update]);
            }
        }
        if (pendingApplications.length === 0) {
            return;
        }

        const previousState = {
            autoClear: renderer.autoClear,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            renderTarget: renderer.getRenderTarget(),
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
        };

        renderer.autoClear = false;
        renderer.sortObjects = false;

        for (const [pendingUpdateId, pendingUpdate] of pendingApplications) {
            this.pendingUpdates.delete(pendingUpdateId);

            this.convertData(renderer, pendingUpdate.heightmapSamples);

            const tileLocalInfos = this.getTileLocalInfos(pendingUpdate.tileId);

            renderer.setRenderTarget(tileLocalInfos.rootTexture.renderTarget);

            if (!tileLocalInfos.rootTexture.hasBeenClearedOnce) {
                renderer.setClearColor(0x000000, 0);
                setViewportWholeRendertarget(renderer, tileLocalInfos.rootTexture.renderTarget);
                renderer.clear(true, true);
                tileLocalInfos.rootTexture.hasBeenClearedOnce = true;
            }

            if (tileLocalInfos.rootTexture.isStub && pendingUpdate.tileId.nestingLevel !== 0) {
                this.expandRootTexture(tileLocalInfos.rootTexture, renderer);
            }

            if (tileLocalInfos.rootTexture.isStub) {
                setViewportWholeRendertarget(renderer, tileLocalInfos.rootTexture.renderTarget);
            } else {
                setViewportInvariantVec4(renderer, tileLocalInfos.textureUv.clone().multiplyScalar(this.rootTileSizeInTexels));
            }

            this.tileStorage.uniforms.uNestingLevel.value = pendingUpdate.tileId.nestingLevel;
            this.fullscreenQuad.material = this.tileStorage.material;
            renderer.render(this.fullscreenQuad, this.fakeCamera);

            for (let iLeafY = tileLocalInfos.fromLeaf.y; iLeafY < tileLocalInfos.toLeaf.y; iLeafY++) {
                for (let iLeafX = tileLocalInfos.fromLeaf.x; iLeafX < tileLocalInfos.toLeaf.x; iLeafX++) {
                    const id = `${iLeafX}_${iLeafY}`;
                    const previousPrecision = tileLocalInfos.rootTexture.dataPerLeafTile.get(id) ?? -Infinity;
                    const newPrecision = Math.max(previousPrecision, pendingUpdate.tileId.nestingLevel);
                    tileLocalInfos.rootTexture.dataPerLeafTile.set(id, newPrecision);
                }
            }
        }

        renderer.autoClear = previousState.autoClear;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setViewport(previousState.viewport);
        renderer.sortObjects = previousState.sortObjects;
    }

    public getTileView(tileId: AtlasTileId): HeightmapAtlasTileView {
        const tileIdString = this.tileIdToString(tileId);
        let tileUsage = this.tilesUsage.get(tileIdString);
        if (!tileUsage) {
            const tileInfos = this.getTileLocalInfos(tileId);
            tileUsage = {
                tileId,
                texture: tileInfos.rootTexture.texture,
                coords: {
                    uv: {
                        origin: new THREE.Vector2(tileInfos.textureUv.x, tileInfos.textureUv.y),
                        size: new THREE.Vector2(tileInfos.textureUv.z, tileInfos.textureUv.w),
                    },
                    world: {
                        origin: new THREE.Vector2(tileInfos.viewportWorld.x, tileInfos.viewportWorld.y),
                        size: new THREE.Vector2(tileInfos.viewportWorld.z, tileInfos.viewportWorld.w),
                    },
                },
                users: new Set(),
                optimalDataUsers: new Set(),
                hasOptimalData: this.hasOptimalDataForTile(tileId),
            };
            this.tilesUsage.set(tileIdString, tileUsage);
        }

        const viewId = Symbol('atlas-viewid');
        tileUsage.users.add(viewId);

        const useOptimalData = () => {
            if (!tileUsage.users.has(viewId)) {
                throw new Error(`Cannot use data of a view that was disposed.`);
            }
            tileUsage.optimalDataUsers.add(viewId);
        };
        const stopUsingOptimalData = () => {
            tileUsage.optimalDataUsers.delete(viewId);
        };
        const stopUsingView = () => {
            if (!tileUsage.users.has(viewId)) {
                throw new Error(`Cannot dispoe view that was not used`);
            }
            tileUsage.optimalDataUsers.delete(viewId);
            tileUsage.users.delete(viewId);
        };

        return {
            tileId: tileUsage.tileId,
            texture: tileUsage.texture,
            coords: tileUsage.coords,
            hasBasicData: () => {
                return this.hasDataForTile(tileId);
            },
            stopUsingView,
            useOptimalData,
            stopUsingOptimalData,
        };
    }

    public getStatistics(): HeightmapAtlasStatistics {
        const result = {
            rootNodesCount: this.rootTextures.size,
            rootNodeTextureSize: this.rootTileSizeInTexels,
            totalGpuMemoryBytes: 0,
        };

        const registerRenderTarget = (renderTarget: THREE.WebGLRenderTarget): void => {
            const pixelsCount = renderTarget.width * renderTarget.height;
            let pixelSize = 4 * renderTarget.textures.length;
            if (renderTarget.depthBuffer) {
                pixelSize += 4;
            }
            result.totalGpuMemoryBytes += pixelsCount * pixelSize;
        };

        for (const texture of this.rootTextures.values()) {
            registerRenderTarget(texture.renderTarget);
        }
        registerRenderTarget(this.copyTexture.renderTarget);

        return result;
    }

    public pushTileData(tileId: AtlasTileId, heightmapSamples: HeightmapSamples): void {
        if (heightmapSamples.altitudes.length !== heightmapSamples.materialIds.length) {
            throw new Error(
                `Incoherent HeightmapSamples: received ${heightmapSamples.altitudes.length} altitude samples and ${heightmapSamples.materialIds.length} materialIds.`
            );
        }
        const samplesPerTileId = this.normalizedPositions.length / 2;
        if (heightmapSamples.altitudes.length !== samplesPerTileId) {
            throw new Error(
                `Incoherent HeightmapSamples: received ${heightmapSamples.altitudes.length} samples, expected ${samplesPerTileId}.`
            );
        }
        const tileIdString = this.tileIdToString(tileId);
        this.pendingUpdates.set(tileIdString, {
            tileId,
            state: 'pending-application',
            heightmapSamples,
        });
    }

    public getUsedTiles(): AtlasTileId[] {
        const result: AtlasTileId[] = [];
        for (const tileUsage of this.tilesUsage.values()) {
            if (tileUsage.optimalDataUsers.size > 0) {
                result.push(tileUsage.tileId);
            }
        }
        return result;
    }

    public getTilesNeedingData(): AtlasTileId[] {
        type TileNeedingData = {
            readonly atlasTileId: AtlasTileId;
            readonly priority: number;
        };

        const tilesNeedingData: TileNeedingData[] = [];

        for (const tileUsage of this.tilesUsage.values()) {
            if (tileUsage.optimalDataUsers.size > 0 && !tileUsage.hasOptimalData) {
                const hasOptimalData = this.hasOptimalDataForTile(tileUsage.tileId);
                if (hasOptimalData) {
                    tileUsage.hasOptimalData = true;
                } else {
                    const tileIdString = this.tileIdToString(tileUsage.tileId);
                    if (!this.pendingUpdates.has(tileIdString)) {
                        const hasBasicData = this.hasDataForTile(tileUsage.tileId);
                        tilesNeedingData.push({
                            atlasTileId: tileUsage.tileId,
                            priority:
                                100000 * Number(!hasBasicData) + // tiles that don't have any data have priority
                                1000 * tileUsage.optimalDataUsers.size + // then tiles that are very requested
                                1000 * tileUsage.tileId.nestingLevel, // then tiles that are high res because they are closer to the player
                        });
                    }
                }
            }
        }

        tilesNeedingData.sort((tile1, tile2) => tile2.priority - tile1.priority);

        return tilesNeedingData.map(tile => tile.atlasTileId);
    }

    public getTileSamplesPositions(tileId: AtlasTileId): Float32Array {
        const worldPositions = new Float32Array(this.normalizedPositions.length);
        this.fillTileSamplesPositions(tileId, worldPositions);
        return worldPositions;
    }

    protected fillTileSamplesPositions(tileId: AtlasTileId, worldPositions: Float32Array): void {
        if (worldPositions.length !== this.normalizedPositions.length) {
            throw new Error();
        }

        const samplesPerTileId = this.normalizedPositions.length / 2;
        const viewportWorld = this.getTileLocalInfos(tileId).viewportWorld;
        for (let iV = 0; iV < samplesPerTileId; iV++) {
            worldPositions[2 * iV + 0] = viewportWorld.x + viewportWorld.z * this.normalizedPositions[2 * iV + 0]!;
            worldPositions[2 * iV + 1] = viewportWorld.y + viewportWorld.w * this.normalizedPositions[2 * iV + 1]!;
        }
    }

    private hasDataForTile(tileId: AtlasTileId): boolean {
        const tileLocalInfos = this.getTileLocalInfos(tileId);
        for (let iLeafY = tileLocalInfos.fromLeaf.y; iLeafY < tileLocalInfos.toLeaf.y; iLeafY++) {
            for (let iLeafX = tileLocalInfos.fromLeaf.x; iLeafX < tileLocalInfos.toLeaf.x; iLeafX++) {
                const id = `${iLeafX}_${iLeafY}`;
                if (!tileLocalInfos.rootTexture.dataPerLeafTile.has(id)) {
                    return false;
                }
            }
        }
        return true;
    }

    private hasOptimalDataForTile(tileId: AtlasTileId): boolean {
        const precision = this.getCurrentPrecisionForTile(tileId);
        return precision !== undefined && precision >= tileId.nestingLevel;
    }

    private getCurrentPrecisionForTile(tileId: AtlasTileId): number | undefined {
        let minimumPrecision: number | undefined;

        const tileLocalInfos = this.getTileLocalInfos(tileId);
        for (let iLeafY = tileLocalInfos.fromLeaf.y; iLeafY < tileLocalInfos.toLeaf.y; iLeafY++) {
            for (let iLeafX = tileLocalInfos.fromLeaf.x; iLeafX < tileLocalInfos.toLeaf.x; iLeafX++) {
                const id = `${iLeafX}_${iLeafY}`;
                const leafTilePrecision = tileLocalInfos.rootTexture.dataPerLeafTile.get(id);
                if (typeof leafTilePrecision === 'undefined') {
                    return undefined;
                }
                if (minimumPrecision === undefined) {
                    minimumPrecision = leafTilePrecision;
                } else {
                    minimumPrecision = Math.min(minimumPrecision, leafTilePrecision);
                }
            }
        }

        return minimumPrecision;
    }

    private deleteUnusedTilesUsage(): void {
        const idsToDelete: string[] = [];
        for (const [id, usage] of this.tilesUsage.entries()) {
            if (usage.users.size === 0) {
                idsToDelete.push(id);
            }
        }

        for (const idToDelete of idsToDelete) {
            this.tilesUsage.delete(idToDelete);
        }
    }

    protected getTileLocalInfos(tileId: AtlasTileId): AtlasTileLocalInfos {
        const rootTileId = {
            x: Math.floor(tileId.x / 2 ** tileId.nestingLevel),
            y: Math.floor(tileId.y / 2 ** tileId.nestingLevel),
        };

        const localTileId = {
            x: safeModulo(tileId.x, 2 ** tileId.nestingLevel),
            y: safeModulo(tileId.y, 2 ** tileId.nestingLevel),
        };

        const uvSize = 1 / 2 ** tileId.nestingLevel;
        const uvX = localTileId.x * uvSize;
        const uvY = localTileId.y * uvSize;
        const viewportUv = new THREE.Vector4(uvX, uvY, uvSize, uvSize);

        const worldSize = this.rootTileSizeInWorld / 2 ** tileId.nestingLevel;
        const viewportWorld = new THREE.Vector4(tileId.x * worldSize, tileId.y * worldSize, worldSize, worldSize);

        const factor = 2 ** (this.maxNestingLevel - tileId.nestingLevel);
        const fromLeaf = { x: localTileId.x * factor, y: localTileId.y * factor };
        const toLeaf = { x: (localTileId.x + 1) * factor, y: (localTileId.y + 1) * factor };

        return { rootTexture: this.getOrBuildRootTexture(rootTileId), textureUv: viewportUv, viewportWorld, fromLeaf, toLeaf };
    }

    private getOrBuildRootTexture(rootTileId: THREE.Vector2Like): AtlasTexture {
        const rootIdString = `${rootTileId.x}_${rootTileId.y}`;
        let rootTexture = this.rootTextures.get(rootIdString);
        if (!rootTexture) {
            const renderTarget = new THREE.WebGLRenderTarget(this.leafTileSizeInTexels, this.leafTileSizeInTexels, {
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                generateMipmaps: false,
                depthBuffer: true,
                stencilBuffer: false,
                colorSpace: THREE.LinearSRGBColorSpace,
            });
            const texture = renderTarget.texture;
            rootTexture = { renderTarget, texture, hasBeenClearedOnce: false, isStub: true, dataPerLeafTile: new Map() };
            this.rootTextures.set(rootIdString, rootTexture);
        }
        return rootTexture;
    }

    private expandRootTexture(atlasTexture: AtlasTexture, renderer: THREE.WebGLRenderer): void {
        if (!atlasTexture.isStub) {
            logger.warn(`Cannot expand twice a root texture.`);
            return;
        }

        this.fullscreenQuad.material = this.copyTexture.material;

        this.copyTexture.textureUniform.value = atlasTexture.texture;
        renderer.setRenderTarget(this.copyTexture.renderTarget);
        setViewportWholeRendertarget(renderer, this.copyTexture.renderTarget);
        renderer.render(this.fullscreenQuad, this.fakeCamera);

        atlasTexture.renderTarget.setSize(this.rootTileSizeInTexels, this.rootTileSizeInTexels);

        this.copyTexture.textureUniform.value = this.copyTexture.renderTarget.texture;
        renderer.setRenderTarget(atlasTexture.renderTarget);
        setViewportWholeRendertarget(renderer, atlasTexture.renderTarget);
        renderer.render(this.fullscreenQuad, this.fakeCamera);

        atlasTexture.isStub = false;
    }

    protected tileIdToString(tileId: AtlasTileId): string {
        return `${tileId.nestingLevel}_${tileId.x}_${tileId.y}`;
    }

    private convertData(renderer: THREE.WebGLRenderer, samples: HeightmapSamples): void {
        if (samples.altitudes.length !== samples.materialIds.length) {
            throw new Error(
                `Invalid HeightmapSamples: ${samples.altitudes.length} altitudes and ${samples.materialIds.length} materialIds`
            );
        }

        const samplesCount = samples.altitudes.length;
        const expectedSamplesCount = this.dataConversion.renderTarget.width * this.dataConversion.renderTarget.height;
        if (samplesCount !== expectedSamplesCount) {
            throw new Error(`Invalid HeightmapSamples samples count: expected ${expectedSamplesCount} but received ${samplesCount}`);
        }

        this.dataConversion.altitudeBuffer.set(samples.altitudes);
        this.dataConversion.altitudeTexture.needsUpdate = true;

        this.dataConversion.materialIdBuffer.set(samples.materialIds);
        this.dataConversion.materialIdTexture.needsUpdate = true;

        const previousState = {
            renderTarget: renderer.getRenderTarget(),
            viewport: renderer.getViewport(new THREE.Vector4()),
        };

        renderer.setRenderTarget(this.dataConversion.renderTarget);
        setViewportWholeRendertarget(renderer, this.dataConversion.renderTarget);
        this.fullscreenQuad.material = this.dataConversion.material;
        renderer.render(this.fullscreenQuad, this.fakeCamera);
        renderer.setViewport(previousState.viewport);
        renderer.setRenderTarget(previousState.renderTarget);
    }
}

export { HeightmapAtlas, type AtlasTileId, type HeightmapAtlasStatistics, type HeightmapAtlasTileView, type Parameters };
