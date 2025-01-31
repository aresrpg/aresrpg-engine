import * as THREE from '../../../../libs/three-usage';
import { type IHeightmapSample } from '../../i-heightmap';

import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly baseCellSize: number;
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
    public readonly texture: THREE.Texture;

    public readonly tilePositions: ReadonlyArray<{ readonly x: number; readonly z: number }>; // in [0, 1]

    private readonly rendertarget: THREE.WebGLRenderTarget;
    private readonly maxNesting: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly computedTilesIds = new Set<string>();

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
        const textureSize = params.baseCellSize * 2 ** params.maxNesting;
        this.rendertarget = new THREE.WebGLRenderTarget(textureSize, textureSize);
        const texture = this.rendertarget.texture;
        if (!texture) {
            throw new Error();
        }
        texture.magFilter = THREE.NearestFilter;
        this.texture = texture;
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

            out vec4 fragColor;

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
        this.texture.dispose();
        this.rendertarget.dispose();
        this.computedTilesIds.clear();
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
        renderer.setRenderTarget(this.rendertarget);

        if (this.isFirstUpdate) {
            renderer.clear(true, true);
            this.isFirstUpdate = false;
        }

        const uvChunk = this.getTileUv(tileId);
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
            this.computedTilesIds.add(cellIdString);
        }

        renderer.autoClear = previousState.autoClear;
        renderer.autoClearColor = previousState.autoClearColor;
        renderer.autoClearDepth = previousState.autoClearDepth;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setRenderTarget(previousState.renderTarget);
    }

    public hasFullTile(tileId: TileId): boolean {
        for (const cellId of this.getCellIdsListForTile(tileId)) {
            if (!this.hasCell(cellId)) {
                return false;
            }
        }
        return true;
    }

    private hasCell(cellId: CellId): boolean {
        const cellIdString = buildCellIdString(cellId);
        return this.computedTilesIds.has(cellIdString);
    }

    public getTileUv(tileId: TileId): UvChunk {
        const scale = 1 / 2 ** tileId.nestingLevel;
        const shift = {
            x: tileId.localCoords.x * scale,
            y: tileId.localCoords.z * scale,
        };
        return { scale, shift };
    }

    // public getPositions(): THREE.Vector3Like
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
