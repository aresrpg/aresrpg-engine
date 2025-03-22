import { createFullscreenQuad } from '../../../helpers/fullscreen-quad';
import { safeModulo } from '../../../helpers/math';
import * as THREE from '../../../libs/three-usage';
import type { MaterialsStore } from '../../materials-store';
import type { HeightmapSamples, IHeightmap } from '../i-heightmap';

type Parameters = {
    readonly heightmap: IHeightmap;
    readonly materialsStore: MaterialsStore;
    readonly texelSizeInWorld: number;
    readonly leafTileSizeInWorld: number;
    readonly maxTextureSize?: number;
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

type PendingUpdate =
    | {
          readonly tileId: AtlasTileId;
          readonly state: 'pending-request';
      }
    | {
          readonly tileId: AtlasTileId;
          readonly state: 'pending-response';
      }
    | {
          readonly tileId: AtlasTileId;
          readonly state: 'pending-update';
          readonly heightmapSamples: HeightmapSamples;
      };

type AtlasTileId = {
    readonly nestingLevel: number; // 0: the whole texture, 1: a quarter, etc.
    readonly x: number; // level-relative world ID
    readonly y: number; // level-relative world ID
};
function tileIdToString(tileId: AtlasTileId): string {
    return `${tileId.nestingLevel}_${tileId.x}_${tileId.y}`;
}

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
    hasData(): boolean;
    hasOptimalData(): boolean;
    requestData(): void;
};

class HeightmapAtlas {
    public readonly heightmap: IHeightmap;

    public readonly texelSizeInWorld: number;

    public readonly rootTileSizeInTexels: number;
    public readonly rootTileSizeInWorld: number;

    public readonly leafTileSizeInWorld: number;
    public readonly leafTileSizeInTexels: number;

    public readonly maxNestingLevel: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly tileGrid: {
        readonly normalizedPositions: Float32Array;
        readonly mesh: THREE.Mesh;
        readonly materialIdAttribute: THREE.Float32BufferAttribute;
        readonly altitudeAttribute: THREE.Float32BufferAttribute;
        readonly material: THREE.RawShaderMaterial;
        readonly levelUniform: THREE.IUniform<number>;
    };

    private readonly textureExpansion: {
        readonly fullscreenQuad: THREE.Mesh;
        readonly copyMaterial: THREE.Material;
        readonly renderTarget: THREE.WebGLRenderTarget;
        readonly textureUniform: THREE.IUniform<THREE.Texture | null>;
    };

    private readonly pendingUpdates = new Map<string, PendingUpdate>();
    private lastRequestsBatchTimestamp: number | null = null;

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

        this.heightmap = params.heightmap;

        this.texelSizeInWorld = params.texelSizeInWorld;

        this.rootTileSizeInTexels = rootTileSizeInTexels;
        this.rootTileSizeInWorld = this.rootTileSizeInTexels * this.texelSizeInWorld;

        this.leafTileSizeInTexels = leafTileSizeInTexels;
        this.leafTileSizeInWorld = params.leafTileSizeInWorld;

        this.maxNestingLevel = maxNestingLevel;

        const materialIdAttribute = new THREE.Uint32BufferAttribute(new Uint32Array(this.leafTileSizeInTexels ** 2), 1);
        const altitudeAttribute = new THREE.Float32BufferAttribute(new Float32Array(this.leafTileSizeInTexels ** 2), 1);
        const normalizedPositions: number[] = [];
        for (let iY = 0; iY < this.leafTileSizeInTexels; iY++) {
            for (let iX = 0; iX < this.leafTileSizeInTexels; iX++) {
                normalizedPositions.push(iX / (this.leafTileSizeInTexels - 1), iY / (this.leafTileSizeInTexels - 1));
            }
        }
        const positionsAttribute = new THREE.Float32BufferAttribute(normalizedPositions, 2);
        const buildIndex = (x: number, y: number): number => {
            if (x < 0 || y < 0 || x >= this.leafTileSizeInTexels || y >= this.leafTileSizeInTexels) {
                throw new Error();
            }
            return x + y * this.leafTileSizeInTexels;
        };
        const indices: number[] = [];
        for (let iY = 0; iY < this.leafTileSizeInTexels - 1; iY++) {
            for (let iX = 0; iX < this.leafTileSizeInTexels - 1; iX++) {
                const i00 = buildIndex(iX, iY);
                const i10 = buildIndex(iX + 1, iY);
                const i01 = buildIndex(iX, iY + 1);
                const i11 = buildIndex(iX + 1, iY + 1);
                indices.push(i00, i10, i11, i00, i11, i01);
            }
        }

        const tileGridGeometry = new THREE.BufferGeometry();
        tileGridGeometry.setAttribute('position', positionsAttribute);
        tileGridGeometry.setAttribute('materialId', materialIdAttribute);
        tileGridGeometry.setAttribute('altitude', altitudeAttribute);
        tileGridGeometry.setIndex(indices);

        const levelUniform: THREE.IUniform<number> = { value: 0 };
        const material = new THREE.RawShaderMaterial({
            glslVersion: '300 es',
            uniforms: {
                uLevelUniform: levelUniform,
                uMaterialsTexture: { value: params.materialsStore.texture },
            },
            vertexShader: `
                in vec2 position;
                in uint materialId;
                in float altitude;

                uniform float uLevelUniform;
                uniform sampler2D uMaterialsTexture;

                out vec3 vColor;
                out float vAltitude;

                ${params.materialsStore.glslDeclaration}

                void main() {
                    gl_Position = vec4(2.0 * position - 1.0, uLevelUniform / ${(maxNestingLevel + 1).toFixed(1)}, 1);

                    vColor = getVoxelMaterial(materialId, uMaterialsTexture, 0.0).color;

                    const float minAltitude = ${params.heightmap.altitude.min.toFixed(1)};
                    const float maxAltitude = ${params.heightmap.altitude.max.toFixed(1)};
                    vAltitude = (altitude - minAltitude) / (maxAltitude - minAltitude);
                }
            `,
            fragmentShader: `
            precision mediump float;

            in vec3 vColor;
            in float vAltitude;

            out vec4 fragColor;

            void main() {
                fragColor = vec4(vColor, vAltitude);
            }
            `,
            blending: THREE.NoBlending,
        });
        const tileMesh = new THREE.Mesh(tileGridGeometry, material);
        tileMesh.frustumCulled = false;
        this.tileGrid = {
            normalizedPositions: new Float32Array(normalizedPositions),
            mesh: tileMesh,
            materialIdAttribute,
            altitudeAttribute,
            material,
            levelUniform,
        };

        const textureExpansionUniform = { value: null };
        this.textureExpansion = {
            fullscreenQuad: createFullscreenQuad('position'),
            renderTarget: new THREE.WebGLRenderTarget(this.leafTileSizeInTexels, this.leafTileSizeInTexels, {
                wrapS: THREE.ClampToEdgeWrapping,
                wrapT: THREE.ClampToEdgeWrapping,
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                generateMipmaps: false,
                depthBuffer: false,
                colorSpace: THREE.LinearSRGBColorSpace,
            }),
            copyMaterial: new THREE.RawShaderMaterial({
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
        if (this.pendingUpdates.size === 0) {
            return;
        }

        const now = performance.now();
        if (this.lastRequestsBatchTimestamp === null || now - this.lastRequestsBatchTimestamp > 200) {
            this.solvePendingRequests();
            this.lastRequestsBatchTimestamp = now;
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

        const appliedUpdateIdsList: string[] = [];
        for (const [updateId, pendingUpdate] of this.pendingUpdates.entries()) {
            if (pendingUpdate.state !== 'pending-update') {
                continue;
            }
            appliedUpdateIdsList.push(updateId);

            const tileLocalInfos = this.getTileLocalInfos(pendingUpdate.tileId);

            renderer.setRenderTarget(tileLocalInfos.rootTexture.renderTarget);

            if (!tileLocalInfos.rootTexture.hasBeenClearedOnce) {
                renderer.setClearColor(0x000000, 0);
                renderer.setViewport(0, 0, tileLocalInfos.rootTexture.renderTarget.width, tileLocalInfos.rootTexture.renderTarget.height);
                renderer.clear(true, true);
                tileLocalInfos.rootTexture.hasBeenClearedOnce = true;
            }

            if (tileLocalInfos.rootTexture.isStub && pendingUpdate.tileId.nestingLevel !== 0) {
                // resize
                renderer.setRenderTarget(this.textureExpansion.renderTarget);
                this.textureExpansion.textureUniform.value = tileLocalInfos.rootTexture.renderTarget.texture;
                this.textureExpansion.fullscreenQuad.material = this.textureExpansion.copyMaterial;
                renderer.setViewport(0, 0, this.textureExpansion.renderTarget.width, this.textureExpansion.renderTarget.height);
                renderer.render(this.textureExpansion.fullscreenQuad, this.fakeCamera);

                tileLocalInfos.rootTexture.renderTarget.setSize(this.rootTileSizeInTexels, this.rootTileSizeInTexels);

                renderer.setRenderTarget(tileLocalInfos.rootTexture.renderTarget);
                this.textureExpansion.textureUniform.value = this.textureExpansion.renderTarget.texture;
                this.textureExpansion.fullscreenQuad.material = this.textureExpansion.copyMaterial;
                renderer.setViewport(0, 0, tileLocalInfos.rootTexture.renderTarget.width, tileLocalInfos.rootTexture.renderTarget.height);
                renderer.render(this.textureExpansion.fullscreenQuad, this.fakeCamera);

                tileLocalInfos.rootTexture.isStub = false;
            }

            if (tileLocalInfos.rootTexture.isStub) {
                renderer.setViewport(0, 0, tileLocalInfos.rootTexture.renderTarget.width, tileLocalInfos.rootTexture.renderTarget.height);
            } else {
                renderer.setViewport(tileLocalInfos.textureUv.clone().multiplyScalar(this.rootTileSizeInTexels));
            }

            this.tileGrid.materialIdAttribute.array.set(pendingUpdate.heightmapSamples.materialIds);
            this.tileGrid.materialIdAttribute.needsUpdate = true;
            this.tileGrid.altitudeAttribute.array.set(pendingUpdate.heightmapSamples.altitudes);
            this.tileGrid.altitudeAttribute.needsUpdate = true;

            renderer.render(this.tileGrid.mesh, this.fakeCamera);

            for (let iLeafY = tileLocalInfos.fromLeaf.y; iLeafY < tileLocalInfos.toLeaf.y; iLeafY++) {
                for (let iLeafX = tileLocalInfos.fromLeaf.x; iLeafX < tileLocalInfos.toLeaf.x; iLeafX++) {
                    const id = `${iLeafX}_${iLeafY}`;
                    const previousPrecision = tileLocalInfos.rootTexture.dataPerLeafTile.get(id) ?? -Infinity;
                    const newPrecision = Math.max(previousPrecision, pendingUpdate.tileId.nestingLevel);
                    tileLocalInfos.rootTexture.dataPerLeafTile.set(id, newPrecision);
                }
            }
        }

        for (const appliedUpdateId of appliedUpdateIdsList) {
            this.pendingUpdates.delete(appliedUpdateId);
        }

        renderer.autoClear = previousState.autoClear;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setViewport(previousState.viewport);
        renderer.sortObjects = previousState.sortObjects;
    }

    public getTileView(tileId: AtlasTileId): HeightmapAtlasTileView {
        const tileInfos = this.getTileLocalInfos(tileId);
        return {
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
            hasData: () => {
                return this.hasDataForTile(tileId);
            },
            hasOptimalData: () => {
                return this.hasOptimalDataForTile(tileId);
            },
            requestData: () => {
                this.requestTileData(tileId);
            },
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
        registerRenderTarget(this.textureExpansion.renderTarget);

        return result;
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

    private async requestTileData(tileId: AtlasTileId): Promise<void> {
        const tileIdString = tileIdToString(tileId);
        if (this.pendingUpdates.has(tileIdString)) {
            return;
        }
        this.pendingUpdates.set(tileIdString, { tileId, state: 'pending-request' });
    }

    private solvePendingRequests(): void {
        const pendingRequests = Array.from(this.pendingUpdates.entries()).filter(
            ([_, pendingUpdate]) => pendingUpdate.state === 'pending-request'
        );

        for (const [tileIdString, pendingRequest] of pendingRequests) {
            const worldPositions = this.getTileWorldPositions(pendingRequest.tileId);
            const result = this.heightmap.sampleHeightmap(worldPositions);
            if (result instanceof Promise) {
                this.pendingUpdates.set(tileIdString, { tileId: pendingRequest.tileId, state: 'pending-response' });
                result.then(heightmapSamples => {
                    this.pendingUpdates.set(tileIdString, {
                        tileId: pendingRequest.tileId,
                        state: 'pending-update',
                        heightmapSamples,
                    });
                });
            } else {
                this.pendingUpdates.set(tileIdString, {
                    tileId: pendingRequest.tileId,
                    state: 'pending-update',
                    heightmapSamples: result,
                });
            }
        }
    }

    private getTileWorldPositions(tileId: AtlasTileId): Float32Array {
        const viewportWorld = this.getTileLocalInfos(tileId).viewportWorld;

        const result = new Float32Array(this.tileGrid.normalizedPositions.length);
        for (let iV = 0; iV < this.tileGrid.normalizedPositions.length / 2; iV++) {
            result[2 * iV + 0] = viewportWorld.x + viewportWorld.z * this.tileGrid.normalizedPositions[2 * iV + 0]!;
            result[2 * iV + 1] = viewportWorld.y + viewportWorld.w * this.tileGrid.normalizedPositions[2 * iV + 1]!;
        }
        return result;
    }

    private getTileLocalInfos(tileId: AtlasTileId): AtlasTileLocalInfos {
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
}

export { HeightmapAtlas, type AtlasTileId, type HeightmapAtlasStatistics, type HeightmapAtlasTileView, type Parameters };
