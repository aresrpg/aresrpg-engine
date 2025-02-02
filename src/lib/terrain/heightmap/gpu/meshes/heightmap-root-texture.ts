import * as THREE from '../../../../libs/three-usage';
import { type IHeightmapSample } from '../../i-heightmap';

import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly baseCellSizeInTexels: number;
    readonly texelSizeInWorld: number;
    readonly maxNesting: number;
    readonly minAltitude: number;
    readonly maxAltitude: number;
    readonly geometryStore: TileGeometryStore;
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
    public readonly textures: [THREE.Texture, THREE.Texture];

    public readonly tilePositions: ReadonlyArray<{ readonly x: number; readonly z: number }>; // in [0, 1]

    private needsUpdate: boolean = false;

    private readonly rawRendertarget: THREE.WebGLRenderTarget;

    private readonly finalization: {
        readonly rendertarget: THREE.WebGLRenderTarget;
        readonly material: THREE.ShaderMaterial;
    };

    private readonly maxNesting: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly computedCellsPrecisions = new Map<string, number>();

    private readonly tile: {
        readonly mesh: THREE.Mesh;
        readonly colorAttribute: THREE.Float32BufferAttribute;
        readonly altitudeAttribute: THREE.Float32BufferAttribute;
        readonly shader: {
            readonly material: THREE.RawShaderMaterial;
            readonly uniforms: {
                readonly uNestingLevel: THREE.IUniform<number>;
                readonly uUvScale: THREE.IUniform<number>;
                readonly uUvShift: THREE.IUniform<THREE.Vector2Like>;
            };
        };
    };

    private isFirstUpdate: boolean = true;

    public constructor(params: Parameters) {
        const textureSize = params.baseCellSizeInTexels * 2 ** params.maxNesting;

        this.rawRendertarget = new THREE.WebGLRenderTarget(textureSize, textureSize, { generateMipmaps: false });
        const rawTexture = this.rawRendertarget.texture;
        if (!rawTexture) {
            throw new Error();
        }

        this.finalization = {
            rendertarget: new THREE.WebGLRenderTarget(textureSize, textureSize, { count: 2, generateMipmaps: false, depthBuffer: false }),
            material: new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    uTexture: { value: rawTexture },
                },
                vertexShader: `
                in vec3 position;

                out vec2 vUv;

                void main() {
                    gl_Position = vec4(2.0 * position.xz - 1.0, 0, 1);
                    vUv = position.xz;
                }
                `,
                fragmentShader: `
                precision mediump float;

                uniform sampler2D uTexture;

                in vec2 vUv;

                layout (location=0) out vec4 fragColor1;
                layout (location=1) out vec4 fragColor2;

                #include <packing>

                vec3 computeNormal() {
                    const float texelSize = 1.0 / ${textureSize.toFixed(1)};
                    float altitudeLeft =  texture(uTexture, vUv - vec2(texelSize, 0)).a;
                    float altitudeRight = texture(uTexture, vUv + vec2(texelSize, 0)).a;
                    float altitudeUp =    texture(uTexture, vUv + vec2(0, texelSize)).a;
                    float altitudeDown =  texture(uTexture, vUv - vec2(0, texelSize)).a;

                    return normalize(vec3(
                        altitudeLeft - altitudeRight,
                        ${((2 * params.texelSizeInWorld) / (params.maxAltitude - params.minAltitude)).toFixed(5)},
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

        const finalTexture0 = this.finalization.rendertarget.textures[0];
        const finalTexture1 = this.finalization.rendertarget.textures[1];
        if (!finalTexture0 || !finalTexture1) {
            throw new Error();
        }
        this.textures = [finalTexture0, finalTexture1];
        for (const texture of this.textures) {
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearFilter;
        }
        this.maxNesting = params.maxNesting;

        const tileGeometry = params.geometryStore.getBaseTile().clone();
        const positionAttribute = tileGeometry.getAttribute('position');
        const positions: THREE.Vector3Like[] = [];
        for (let iIndex = 0; iIndex < positionAttribute.array.length; iIndex += 3) {
            positions.push(
                new THREE.Vector3(
                    positionAttribute.array[iIndex + 0]!,
                    positionAttribute.array[iIndex + 1]!,
                    positionAttribute.array[iIndex + 2]!
                )
            );
        }
        this.tilePositions = positions;

        const uniforms = {
            uNestingLevel: { value: 0 },
            uMinAltitude: { value: params.minAltitude },
            uMaxAltitude: { value: params.maxAltitude },
            uUvScale: { value: 1 },
            uUvShift: { value: new THREE.Vector2() },
        };
        const material = new THREE.RawShaderMaterial({
            glslVersion: '300 es',
            uniforms,
            vertexShader: `
            uniform vec2 uUvShift;
            uniform float uUvScale;
            uniform float uNestingLevel;
            uniform float uMinAltitude;
            uniform float uMaxAltitude;

            in vec3 position;
            in vec3 color;
            in float altitude;

            out vec3 vColor;
            out float vAltitude;

            void main() {
                vec2 uv = uUvShift + position.xz * uUvScale;
                gl_Position = vec4(2.0 * uv - 1.0, 1.0 - uNestingLevel / 200.0, 1);
                vColor = color;
                vAltitude = (altitude - uMinAltitude) / (uMaxAltitude - uMinAltitude);
            }
            `,
            fragmentShader: `
            precision mediump float;

            in vec3 vColor;
            in float vAltitude;

            layout (location=0) out vec4 fragColor;

            #include <packing>

            void main() {
                fragColor = vec4(vColor, vAltitude);
            }
            `,
            blending: THREE.NoBlending,
            side: THREE.DoubleSide,
        });
        const colorAttribute = new THREE.Float32BufferAttribute(new Float32Array(3 * positionAttribute.count), 3);
        tileGeometry.setAttribute('color', colorAttribute);
        const altitudeAttribute = new THREE.Float32BufferAttribute(new Float32Array(positionAttribute.count), 1);
        tileGeometry.setAttribute('altitude', altitudeAttribute);

        const mesh = new THREE.Mesh(tileGeometry, material);
        mesh.frustumCulled = false;

        this.tile = { mesh, colorAttribute, altitudeAttribute, shader: { material, uniforms } };
    }

    public dispose(): void {
        for (const texture of this.textures) {
            texture.dispose();
        }
        this.rawRendertarget.dispose();
        this.finalization.rendertarget.dispose();
        this.computedCellsPrecisions.clear();
    }

    public renderTile(tileId: TileId, renderer: THREE.WebGLRenderer, tileSamples: ReadonlyArray<IHeightmapSample>): void {
        if (tileSamples.length !== this.tilePositions.length) {
            throw new Error();
        }

        const previousState = {
            autoClear: renderer.autoClear,
            autoClearColor: renderer.autoClearColor,
            autoClearDepth: renderer.autoClearDepth,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            renderTarget: renderer.getRenderTarget(),
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
        this.tile.mesh.material = this.tile.shader.material;
        this.tile.shader.uniforms.uUvScale.value = uvChunk.scale;
        this.tile.shader.uniforms.uUvShift.value = uvChunk.shift;
        this.tile.shader.uniforms.uNestingLevel.value = tileId.nestingLevel;
        this.tile.shader.material.uniformsNeedUpdate = true;

        tileSamples.forEach((sample: IHeightmapSample, index: number) => {
            this.tile.altitudeAttribute.array[index] = sample.altitude;
            this.tile.colorAttribute.array[3 * index + 0] = sample.color.r;
            this.tile.colorAttribute.array[3 * index + 1] = sample.color.g;
            this.tile.colorAttribute.array[3 * index + 2] = sample.color.b;
        });
        this.tile.altitudeAttribute.needsUpdate = true;
        this.tile.colorAttribute.needsUpdate = true;

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

        this.needsUpdate = true;
    }

    public update(renderer: THREE.WebGLRenderer): void {
        if (!this.needsUpdate) {
            return;
        }

        this.tile.mesh.material = this.finalization.material;

        const previousRendertarget = renderer.getRenderTarget();

        renderer.setRenderTarget(this.finalization.rendertarget);

        renderer.render(this.tile.mesh, this.fakeCamera);

        renderer.setRenderTarget(previousRendertarget);

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
