import { createFullscreenQuad } from '../../../../helpers/fullscreen-quad';
import * as THREE from '../../../../libs/three-usage';
import { type MaterialsStore } from '../../../materials-store';
import { type HeightmapSamples } from '../../i-heightmap';

import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly materialsStore: MaterialsStore;
    readonly baseCellSizeInTexels: number;
    readonly texelSizeInWorld: number;
    readonly maxNesting: number;
    readonly altitude: {
        readonly min: number;
        readonly max: number;
    };
    readonly geometryStore: TileGeometryStore;
    readonly computeNormalsTexture: boolean;
};

type CellId = {
    readonly x: number;
    readonly z: number;
};
type TileCoords = CellId;
type TileId = {
    readonly nestingLevel: number;
    readonly localCoords: TileCoords; // relative to root
};

type UvChunk = {
    readonly scale: number;
    readonly shift: THREE.Vector2Like;
};

function buildCellIdString(tileId: CellId): string {
    return `${tileId.x}_${tileId.z}`;
}

class HeightmapRootTexture {
    public readonly textures: {
        readonly colorAndAltitude: THREE.Texture;
        readonly normals?: THREE.Texture;
    };

    public readonly tilePositions: Float32Array; // in [0, 1]

    private needsUpdate: boolean = false;

    private readonly rawRendertarget: THREE.WebGLRenderTarget;

    private readonly finalization: {
        readonly fullscreenQuad: THREE.Mesh;
        readonly rendertarget: THREE.WebGLRenderTarget;
        readonly material: THREE.ShaderMaterial;
    } | null = null;

    private readonly maxNesting: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly computedCellsPrecisions = new Map<string, number>();

    private readonly tile: {
        readonly mesh: THREE.Mesh;
        readonly materialIdAttribute: THREE.Float32BufferAttribute;
        readonly altitudeAttribute: THREE.Float32BufferAttribute;
        readonly shader: {
            readonly material: THREE.RawShaderMaterial;
            readonly uniforms: {
                readonly uNestingLevel: THREE.IUniform<number>;
            };
        };
    };

    private isFirstUpdate: boolean = true;

    public constructor(params: Parameters) {
        const textureSize = params.baseCellSizeInTexels * 2 ** params.maxNesting;

        this.rawRendertarget = new THREE.WebGLRenderTarget(textureSize, textureSize, { generateMipmaps: false });

        if (params.computeNormalsTexture) {
            this.finalization = {
                fullscreenQuad: createFullscreenQuad('position'),
                rendertarget: new THREE.WebGLRenderTarget(textureSize, textureSize, {
                    count: 2,
                    generateMipmaps: false,
                    depthBuffer: false,
                }),
                material: new THREE.RawShaderMaterial({
                    glslVersion: '300 es',
                    uniforms: {
                        uTexture: { value: this.rawRendertarget.texture },
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

                layout (location=0) out vec4 fragColor1;
                layout (location=1) out vec4 fragColor2;

                vec3 computeNormal() {
                    const float texelSize = 1.0 / ${textureSize.toFixed(1)};
                    float altitudeLeft =  texture(uTexture, vUv - vec2(texelSize, 0)).a;
                    float altitudeRight = texture(uTexture, vUv + vec2(texelSize, 0)).a;
                    float altitudeUp =    texture(uTexture, vUv + vec2(0, texelSize)).a;
                    float altitudeDown =  texture(uTexture, vUv - vec2(0, texelSize)).a;

                    return normalize(vec3(
                        altitudeLeft - altitudeRight,
                        ${((2 * params.texelSizeInWorld) / (params.altitude.max - params.altitude.min)).toFixed(5)},
                        altitudeDown - altitudeUp
                    ));
                }

                void main() {
                    vec4 sampled = texture(uTexture, vUv);
                    vec3 color = sampled.rgb;
                    float altitude = sampled.a;
                    vec3 normal = computeNormal();
                    
                    fragColor1 = vec4(color, altitude);
                    fragColor2 = vec4(0.5 + 0.5 * normal, 0);
                }
                `,
                    blending: THREE.NoBlending,
                    side: THREE.DoubleSide,
                }),
            };
            this.finalization.fullscreenQuad.material = this.finalization.material;

            const finalTexture0 = this.finalization.rendertarget.textures[0];
            const finalTexture1 = this.finalization.rendertarget.textures[1];
            if (!finalTexture0 || !finalTexture1) {
                throw new Error();
            }
            this.textures = { colorAndAltitude: finalTexture0, normals: finalTexture1 };
        } else {
            this.textures = { colorAndAltitude: this.rawRendertarget.texture };
        }

        this.maxNesting = params.maxNesting;

        const tileGeometry = params.geometryStore.getBaseTile().clone();
        const positionAttribute = tileGeometry.getAttribute('position');
        const positions = new Float32Array(2 * positionAttribute.count);
        for (let iPosition = 0; iPosition < positionAttribute.count; iPosition++) {
            positions[2 * iPosition + 0] = positionAttribute.array[3 * iPosition + 0]!;
            positions[2 * iPosition + 1] = positionAttribute.array[3 * iPosition + 2]!;
        }
        this.tilePositions = positions;

        const uniforms = {
            uNestingLevel: { value: 0 },
            uMinAltitude: { value: params.altitude.min },
            uMaxAltitude: { value: params.altitude.max },
        };
        const material = new THREE.RawShaderMaterial({
            glslVersion: '300 es',
            uniforms: {
                ...uniforms,
                uMaterialsTexture: { value: params.materialsStore.texture },
            },
            vertexShader: `
            uniform sampler2D uMaterialsTexture;
            uniform float uNestingLevel;
            uniform float uMinAltitude;
            uniform float uMaxAltitude;

            in vec3 position;
            in uint materialId;
            in float altitude;

            out vec3 vColor;
            out float vAltitude;

            ${params.materialsStore.glslDeclaration}
            
            void main() {
                gl_Position = vec4(2.0 * position.xz - 1.0, 1.0 - uNestingLevel / 200.0, 1);
                vColor = getVoxelMaterial(materialId, uMaterialsTexture, 0.0).color;
                vAltitude = (altitude - uMinAltitude) / (uMaxAltitude - uMinAltitude);
            }
            `,
            fragmentShader: `
            precision mediump float;

            in vec3 vColor;
            in float vAltitude;

            layout (location=0) out vec4 fragColor;

            void main() {
                fragColor = vec4(vColor, vAltitude);
            }
            `,
            blending: THREE.NoBlending,
            side: THREE.DoubleSide,
        });
        const materialIdAttribute = new THREE.Uint32BufferAttribute(new Uint32Array(positionAttribute.count), 1);
        tileGeometry.setAttribute('materialId', materialIdAttribute);
        const altitudeAttribute = new THREE.Float32BufferAttribute(new Float32Array(positionAttribute.count), 1);
        tileGeometry.setAttribute('altitude', altitudeAttribute);

        const mesh = new THREE.Mesh(tileGeometry, material);
        mesh.frustumCulled = false;

        this.tile = { mesh, materialIdAttribute, altitudeAttribute, shader: { material, uniforms } };

        (window as any).rootTexture = this.textures.colorAndAltitude;
    }

    public dispose(): void {
        for (const texture of this.rawRendertarget.textures) {
            texture.dispose();
        }
        this.rawRendertarget.dispose();

        if (this.finalization) {
            for (const texture of this.finalization.rendertarget.textures) {
                texture.dispose();
            }
            this.finalization.fullscreenQuad.geometry.dispose();
            this.finalization.rendertarget.dispose();
            this.finalization.material.dispose();
        }

        this.computedCellsPrecisions.clear();
    }

    public renderTile(tileId: TileId, renderer: THREE.WebGLRenderer, tileSamples: HeightmapSamples): void {
        const expectedSamplesCount = this.tilePositions.length / 2;
        if (tileSamples.altitudes.length !== expectedSamplesCount || tileSamples.altitudes.length !== expectedSamplesCount) {
            throw new Error();
        }

        const previousState = {
            autoClear: renderer.autoClear,
            autoClearColor: renderer.autoClearColor,
            autoClearDepth: renderer.autoClearDepth,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            renderTarget: renderer.getRenderTarget(),
            viewport: renderer.getViewport(new THREE.Vector4()),
        };

        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.autoClearDepth = false;
        renderer.setClearColor(0x000000);
        renderer.setClearAlpha(0);
        renderer.setRenderTarget(this.rawRendertarget);

        if (this.isFirstUpdate) {
            renderer.clear(true, true);
            this.isFirstUpdate = false;
        }

        const uvChunk = this.getTileUv(tileId);
        renderer.setViewport(
            uvChunk.shift.x * this.rawRendertarget.width,
            uvChunk.shift.y * this.rawRendertarget.height,
            uvChunk.scale * this.rawRendertarget.width,
            uvChunk.scale * this.rawRendertarget.height,
        );
        this.tile.shader.uniforms.uNestingLevel.value = tileId.nestingLevel;
        this.tile.shader.material.uniformsNeedUpdate = true;

        this.tile.altitudeAttribute.array.set(tileSamples.altitudes);
        this.tile.altitudeAttribute.needsUpdate = true;
        this.tile.materialIdAttribute.array.set(tileSamples.materialIds);
        this.tile.materialIdAttribute.needsUpdate = true;

        renderer.render(this.tile.mesh, this.fakeCamera);

        for (const cellId of this.getCellIdsListForTile(tileId)) {
            const cellIdString = buildCellIdString(cellId);
            const currentComputedPrecisionForCell = this.computedCellsPrecisions.get(cellIdString) ?? -1;
            this.computedCellsPrecisions.set(cellIdString, Math.max(currentComputedPrecisionForCell, tileId.nestingLevel));
        }

        renderer.autoClear = previousState.autoClear;
        renderer.autoClearColor = previousState.autoClearColor;
        renderer.autoClearDepth = previousState.autoClearDepth;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setViewport(previousState.viewport);

        if (this.finalization) {
            this.needsUpdate = true;
        }
    }

    public update(renderer: THREE.WebGLRenderer): void {
        if (!this.needsUpdate || !this.finalization) {
            return;
        }

        const previousState = {
            renderTarget: renderer.getRenderTarget(),
            sortObjects: renderer.sortObjects,
        };

        renderer.sortObjects = false;
        renderer.setRenderTarget(this.finalization.rendertarget);

        renderer.render(this.finalization.fullscreenQuad, this.fakeCamera);

        renderer.setRenderTarget(previousState.renderTarget);
        renderer.sortObjects = previousState.sortObjects;

        this.needsUpdate = false;
    }

    public hasDataForTile(tileId: TileId): boolean {
        const precision = this.getCurrentPrecisionForTile(tileId);
        return precision !== undefined;
    }

    public hasOptimalDataForTile(tileId: TileId): boolean {
        const precision = this.getCurrentPrecisionForTile(tileId);
        return precision !== undefined && precision >= tileId.nestingLevel;
    }

    public getTileUv(tileId: TileId): UvChunk {
        const scale = 1 / 2 ** tileId.nestingLevel;
        const shift = {
            x: tileId.localCoords.x * scale,
            y: tileId.localCoords.z * scale,
        };
        return { scale, shift };
    }

    public getTotalGpuMemoryBytes(): number {
        const computeRendertargetMemoryBytes = (rendertarget: THREE.WebGLRenderTarget): number => {
            const pixelsCount = rendertarget.width * rendertarget.height;
            const texturesCount = rendertarget.textures.length + +!!rendertarget.depthTexture;
            return texturesCount * pixelsCount * 4;
        };

        let total = 0;
        total += computeRendertargetMemoryBytes(this.rawRendertarget);
        if (this.finalization) {
            total += computeRendertargetMemoryBytes(this.finalization.rendertarget);
        }
        return total;
    }

    private getCurrentPrecisionForTile(tileId: TileId): number | undefined {
        let minimumPrecision: number | undefined;
        for (const cellId of this.getCellIdsListForTile(tileId)) {
            const cellIdString = buildCellIdString(cellId);
            const cellPrecision = this.computedCellsPrecisions.get(cellIdString);
            if (cellPrecision === undefined) {
                return undefined;
            }
            if (minimumPrecision === undefined) {
                minimumPrecision = cellPrecision;
            } else {
                minimumPrecision = Math.min(minimumPrecision, cellPrecision);
            }
        }
        return minimumPrecision;
    }

    private getCellIdsListForTile(tileId: TileId): Iterable<CellId> {
        if (tileId.nestingLevel > this.maxNesting) {
            throw new Error();
        }

        const sizeInBaseCells = 2 ** (this.maxNesting - tileId.nestingLevel);
        const fromBaseCell = {
            x: tileId.localCoords.x * sizeInBaseCells,
            z: tileId.localCoords.z * sizeInBaseCells,
        };
        const toBaseCell = {
            x: fromBaseCell.x + sizeInBaseCells,
            z: fromBaseCell.z + sizeInBaseCells,
        };

        const cellIdsList: CellId[] = [];
        for (let iZ = fromBaseCell.z; iZ < toBaseCell.z; iZ++) {
            for (let iX = fromBaseCell.x; iX < toBaseCell.x; iX++) {
                cellIdsList.push({ x: iX, z: iZ });
            }
        }
        return cellIdsList;
    }
}

export { HeightmapRootTexture, type Parameters, type TileId };
