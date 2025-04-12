import { buildNoiseTexture } from '../../../../helpers/misc';
import { applyReplacements } from '../../../../helpers/string';
import * as THREE from '../../../../libs/three-usage';
import type { HeightmapAtlas } from '../../atlas/heightmap-atlas';

import { HeightmapTile, type TileEdgesDrop, type VisibleTileAttributes } from './heightmap-tile';
import { buildEdgesResolutionId, EEdgeResolution, type TileGeometryStore } from './tile-geometry-store';

enum EDrop {
    UP = 0b00000001,
    DOWN = 0b00000010,
    LEFT = 0b00000100,
    RIGHT = 0b00001000,
    DOWN_LEFT = 0b00010000,
    DOWN_RIGHT = 0b00100000,
    UP_LEFT = 0b01000000,
    UP_RIGHT = 0b10000000,
}

function encodeEdgesDrop(edgesDrop: TileEdgesDrop): number {
    return (
        EDrop.UP * +edgesDrop.up +
        EDrop.DOWN * +edgesDrop.down +
        EDrop.LEFT * +edgesDrop.left +
        EDrop.RIGHT * +edgesDrop.right +
        EDrop.DOWN_LEFT * +edgesDrop.downLeft +
        EDrop.DOWN_RIGHT * +edgesDrop.downRight +
        EDrop.UP_LEFT * +edgesDrop.upLeft +
        EDrop.UP_RIGHT * +edgesDrop.upRight
    );
}

type InstancedTileMesh = {
    readonly mesh: THREE.InstancedMesh;
    readonly instancedAttributes: {
        readonly aSizeWorld: THREE.InstancedBufferAttribute;
        readonly aUvView: THREE.InstancedBufferAttribute;
        readonly aDrop: THREE.InstancedBufferAttribute;
        readonly aDissolveRatio: THREE.InstancedBufferAttribute;
    };
};

type InstancedTile = {
    gpuPosition: {
        readonly edgesResolutionId: string;
        readonly indexInArray: number;
    } | null;
    needsUpdate: boolean;
    deleted: boolean;
    readonly attributes: {
        readonly world: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
        readonly uv: {
            readonly origin: THREE.Vector2Like;
            readonly size: THREE.Vector2Like;
        };
        drop: number;
        dissolveRatio: number;
        edgesResolutionId: string;
    };
};

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly heightmapAtlas: HeightmapAtlas;
    readonly tileId: { x: number; z: number };
    readonly flatShading: boolean;
    readonly transitionTime: number;
};

class HeightmapRootTile extends HeightmapTile {
    public readonly container: THREE.Object3D;

    private static readonly noiseTexture = buildNoiseTexture(64);

    private invisibleSinceTimestamp: number | null = null;

    private readonly material: THREE.MeshPhongMaterial;
    private readonly shadowMaterial: THREE.ShaderMaterial;

    private readonly instancedTileMeshes = new Map<string, InstancedTileMesh>();
    private readonly currentTiles: Map<symbol, InstancedTile>;
    private somethingChanged: boolean = false;

    public constructor(params: Parameters) {
        const currentTiles = new Map<symbol, InstancedTile>();

        super({
            common: {
                geometryStore: params.geometryStore,
                heightmapAtlas: params.heightmapAtlas,
                getInstancedAttributesHandle: () => {
                    const id = Symbol('instanced-tile-attributes-handle');
                    return {
                        setAttributes: (attributes: VisibleTileAttributes) => {
                            const newAttributes = {
                                world: attributes.world,
                                uv: attributes.uv,
                                drop: encodeEdgesDrop(attributes.drop),
                                dissolveRatio: attributes.dissolveRatio,
                                edgesResolutionId: buildEdgesResolutionId(attributes.edgesResolution),
                            };

                            let currentTile = currentTiles.get(id);
                            if (!currentTile) {
                                currentTile = {
                                    gpuPosition: null,
                                    needsUpdate: true,
                                    deleted: false,
                                    attributes: newAttributes,
                                };
                                currentTiles.set(id, currentTile);
                            }

                            if (currentTile.deleted) {
                                throw new Error();
                            }
                            currentTile.needsUpdate = true;
                            currentTile.attributes.drop = newAttributes.drop;
                            currentTile.attributes.dissolveRatio = newAttributes.dissolveRatio;
                            currentTile.attributes.edgesResolutionId = newAttributes.edgesResolutionId;
                            this.somethingChanged = true;
                        },
                        dispose: () => {
                            const currentTile = currentTiles.get(id);
                            if (currentTile) {
                                currentTile.deleted = true;
                                this.somethingChanged = true;
                            }
                        },
                    };
                },
            },
            atlasTileId: { nestingLevel: 0, x: params.tileId.x, y: params.tileId.z },
            transitionTime: params.transitionTime,
        });

        this.container = new THREE.Group();
        this.container.name = `heightmap-root-tile-${params.tileId.x}_${params.tileId.z}`;

        const rootTileView = params.heightmapAtlas.getTileView({ nestingLevel: 0, x: params.tileId.x, y: params.tileId.z });

        const uniforms = {
            uTexture0: { value: rootTileView.texture },
            uTexture1: { value: null },
            uMinAltitude: { value: params.heightmapAtlas.altitude.min },
            uMaxAltitude: { value: params.heightmapAtlas.altitude.max },
            uNoiseTexture: { value: HeightmapRootTile.noiseTexture },
        };

        const hasNormalsTexture = false;
        this.material = new THREE.MeshPhongMaterial({ vertexColors: true });
        this.material.shininess = 0;
        this.material.flatShading = params.flatShading;
        this.material.customProgramCacheKey = () => `heightmap-tile-material-normals=${hasNormalsTexture}`;
        this.material.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
uniform sampler2D uTexture0;
uniform float uMinAltitude;
uniform float uMaxAltitude;

in vec4 aUvView;
in uint aDrop;
in float aDissolveRatio;

out float vDissolveRatio;

float computeDrop(const vec3 position) {
    float isUp = step(0.99, position.z);
    if (isUp * float(aDrop & ${EDrop.UP}u) > 0.5) {
        return 1.0;
    }

    float isDown = step(position.z, 0.01);
    if (isDown * float(aDrop & ${EDrop.DOWN}u) > 0.5) {
        return 1.0;
    }

    float isLeft = step(position.x, 0.01);
    if (isLeft * float(aDrop & ${EDrop.LEFT}u) > 0.5) {
        return 1.0;
    }

    float isRight = step(0.99, position.x);
    if (isRight * float(aDrop & ${EDrop.RIGHT}u) > 0.5) {
        return 1.0;
    }

    if (isDown * (isLeft * float(aDrop & ${EDrop.DOWN_LEFT}u) + isRight * float(aDrop & ${EDrop.DOWN_RIGHT}u)) > 0.5) {
        return 1.0;
    }

    if (isUp * (isLeft * float(aDrop & ${EDrop.UP_LEFT}u) + isRight * float(aDrop & ${EDrop.UP_RIGHT}u)) > 0.5) {
        return 1.0;
    }

    return 0.0;
}

void main() {
    vec2 tileUv = aUvView.xy + position.xz * aUvView.zw;
    vec4 texture0Sample = texture(uTexture0, tileUv);

    vDissolveRatio = aDissolveRatio;
`,
                '#include <begin_vertex>': `
vec3 transformed = position;
float altitude = texture0Sample.a;
transformed.y = mix(uMinAltitude, uMaxAltitude, altitude);

float drop = computeDrop(position);
transformed.y -= 30.0 * drop;
`,
                '#include <color_vertex>': `
vColor = texture0Sample.rgb;
`,
            });

            if (hasNormalsTexture) {
                parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                    'void main() {': `
                uniform sampler2D uTexture1;

                in float aSizeWorld;

                void main() {`,
                    '#include <beginnormal_vertex>': `
                vec4 texture1Sample = texture(uTexture1, tileUv);
                vec3 objectNormal = 2.0 * texture1Sample.rgb - 1.0;
                objectNormal.y /= aSizeWorld;
                `,
                });
            }

            parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
                'void main() {': `
                uniform sampler2D uNoiseTexture;

                in float vDissolveRatio;

                void main() {
                    if (vDissolveRatio > 0.0) {
                        vec2 noiseTextureSize = vec2(textureSize(uNoiseTexture, 0));
                        vec2 dissolveUv = mod(gl_FragCoord.xy, noiseTextureSize) / noiseTextureSize;
                        float dissolveSample = texture(uNoiseTexture, dissolveUv, 0.0).r;
                        if (dissolveSample <= vDissolveRatio) {
                            discard;
                        }
                    }
                `,
            });
        };

        // Custom shadow material using RGBA depth packing.
        // A custom material for shadows is needed here, because the geometry is created inside the vertex shader,
        // so the builtin threejs shadow material will not work.
        // Written like:
        // https://github.com/mrdoob/three.js/blob/2ff77e4b335e31c108aac839a07401664998c730/src/renderers/shaders/ShaderLib/depth.glsl.js#L47
        this.shadowMaterial = new THREE.ShaderMaterial({
            glslVersion: '300 es',
            uniforms,
            vertexShader: `
                uniform sampler2D uTexture0;
                uniform float uMinAltitude;
                uniform float uMaxAltitude;

                in vec4 aUvView;

                out vec2 vHighPrecisionZW;

                void main() {
                    vec2 tileUv = aUvView.xy + position.xz * aUvView.zw;
                    vec4 texture0Sample = texture(uTexture0, tileUv);
                    
                    vec3 modelPosition = position;
                    float altitude = texture0Sample.a;
                    modelPosition.y = mix(uMinAltitude, uMaxAltitude, altitude);

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(modelPosition, 1.0);
                    vHighPrecisionZW = gl_Position.zw;
                }`,
            fragmentShader: `precision highp float;
        
                #include <packing>
        
                in vec2 vHighPrecisionZW;
        
                out vec4 fragColor;
        
                void main(void) {
                    // Higher precision equivalent of gl_FragCoord.z. This assumes depthRange has been left to its default values.
                    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
        
                    // RGBA depth packing 
                    fragColor = packDepthToRGBA( fragCoordZ );
                }`,
        });

        const maxSimultaneousTiles = (2 ** params.heightmapAtlas.maxNestingLevel) ** 2;

        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgeResolution = { up, down, left, right };
                        const bufferGeometry = params.geometryStore.getBufferGeometry(edgeResolution).clone();
                        const mesh = new THREE.InstancedMesh(bufferGeometry, this.material, maxSimultaneousTiles);
                        mesh.count = 0;
                        mesh.customDepthMaterial = this.shadowMaterial;
                        mesh.receiveShadow = true;
                        mesh.castShadow = true;

                        this.container.add(mesh);
                        // disableMatrixAutoupdate(mesh);
                        const id = buildEdgesResolutionId(edgeResolution);

                        const instancedTileMesh = {
                            mesh,
                            instancedAttributes: {
                                aSizeWorld: new THREE.InstancedBufferAttribute(new Float32Array(maxSimultaneousTiles), 1),
                                aUvView: new THREE.InstancedBufferAttribute(new Float32Array(4 * maxSimultaneousTiles), 4),
                                aDrop: new THREE.InstancedBufferAttribute(new Uint32Array(maxSimultaneousTiles), 1),
                                aDissolveRatio: new THREE.InstancedBufferAttribute(new Float32Array(maxSimultaneousTiles), 1),
                            },
                        };
                        bufferGeometry.setAttribute('aSizeWorld', instancedTileMesh.instancedAttributes.aSizeWorld);
                        bufferGeometry.setAttribute('aUvView', instancedTileMesh.instancedAttributes.aUvView);
                        bufferGeometry.setAttribute('aDrop', instancedTileMesh.instancedAttributes.aDrop);
                        bufferGeometry.setAttribute('aDissolveRatio', instancedTileMesh.instancedAttributes.aDissolveRatio);
                        this.instancedTileMeshes.set(id, instancedTileMesh);
                    }
                }
            }
        }

        this.currentTiles = currentTiles;
    }

    public override update(): void {
        super.update();

        if (!this.somethingChanged) {
            return;
        }
        this.somethingChanged = false;

        const tilesToDelete = new Set<symbol>();
        const edgesResolutionIdsToReset = new Set<string>();
        for (const [tileId, tile] of this.currentTiles.entries()) {
            if (tile.gpuPosition && tile.deleted) {
                edgesResolutionIdsToReset.add(tile.gpuPosition.edgesResolutionId);
                tilesToDelete.add(tileId);
            }
        }
        if (tilesToDelete.size > 0) {
            for (const tileToDelete of tilesToDelete.values()) {
                this.currentTiles.delete(tileToDelete);
            }
            for (const edgesResolutionIdToReset of edgesResolutionIdsToReset.values()) {
                const instancedTileMesh = this.instancedTileMeshes.get(edgesResolutionIdToReset);
                if (!instancedTileMesh) {
                    throw new Error();
                }
                instancedTileMesh.mesh.count = 0;
            }
            for (const tile of this.currentTiles.values()) {
                if (edgesResolutionIdsToReset.has(tile.attributes.edgesResolutionId)) {
                    tile.gpuPosition = null;
                }
            }
        }

        for (const currentTile of this.currentTiles.values()) {
            currentTile.gpuPosition = null;
            currentTile.needsUpdate = true;
        }
        for (const instancedTileMesh of this.instancedTileMeshes.values()) {
            instancedTileMesh.mesh.count = 0;
        }

        for (const tile of this.currentTiles.values()) {
            if (tile.needsUpdate) {
                let gpuPosition = tile.gpuPosition;
                if (!gpuPosition) {
                    const instancedTileMesh = this.instancedTileMeshes.get(tile.attributes.edgesResolutionId);
                    if (!instancedTileMesh) {
                        throw new Error();
                    }
                    gpuPosition = {
                        edgesResolutionId: tile.attributes.edgesResolutionId,
                        indexInArray: instancedTileMesh.mesh.count++,
                    };
                    tile.gpuPosition = gpuPosition;

                    instancedTileMesh.mesh.setMatrixAt(
                        gpuPosition.indexInArray,
                        new THREE.Matrix4().multiplyMatrices(
                            new THREE.Matrix4().makeTranslation(tile.attributes.world.origin.x, 0, tile.attributes.world.origin.y),
                            new THREE.Matrix4().makeScale(tile.attributes.world.size.x, 1, tile.attributes.world.size.y)
                        )
                    );
                    instancedTileMesh.mesh.instanceMatrix.needsUpdate = true;

                    instancedTileMesh.instancedAttributes.aSizeWorld.set([tile.attributes.world.size.x], gpuPosition.indexInArray);
                    instancedTileMesh.instancedAttributes.aSizeWorld.needsUpdate = true;

                    instancedTileMesh.instancedAttributes.aUvView.set(
                        [tile.attributes.uv.origin.x, tile.attributes.uv.origin.y, tile.attributes.uv.size.x, tile.attributes.uv.size.y],
                        4 * gpuPosition.indexInArray
                    );
                    instancedTileMesh.instancedAttributes.aUvView.needsUpdate = true;
                }

                const instancedTileMesh = this.instancedTileMeshes.get(gpuPosition.edgesResolutionId);
                if (!instancedTileMesh) {
                    throw new Error();
                }

                const dissolveRatioOnGpu = instancedTileMesh.instancedAttributes.aDissolveRatio.array[gpuPosition.indexInArray];
                if (dissolveRatioOnGpu !== tile.attributes.dissolveRatio) {
                    instancedTileMesh.instancedAttributes.aDissolveRatio.set([tile.attributes.dissolveRatio], gpuPosition.indexInArray);
                    instancedTileMesh.instancedAttributes.aDissolveRatio.needsUpdate = true;
                }

                const dropOnGpu = instancedTileMesh.instancedAttributes.aDrop.array[gpuPosition.indexInArray];
                if (tile.attributes.drop !== dropOnGpu) {
                    instancedTileMesh.instancedAttributes.aDrop.set([tile.attributes.drop], gpuPosition.indexInArray);
                    instancedTileMesh.instancedAttributes.aDrop.needsUpdate = true;
                }

                tile.needsUpdate = false;
            }
        }

        for (const instancedTileMesh of this.instancedTileMeshes.values()) {
            instancedTileMesh.mesh.visible = instancedTileMesh.mesh.count > 0;
        }
    }

    public override setVisibility(visible: boolean): void {
        super.setVisibility(visible);

        if (visible) {
            this.invisibleSinceTimestamp = null;
        } else if (this.invisibleSinceTimestamp === null) {
            this.invisibleSinceTimestamp = performance.now();
        }
    }

    public override dispose(): void {
        super.dispose();

        this.container.clear();
        this.currentTiles.clear();
        for (const instanceTileMesh of this.instancedTileMeshes.values()) {
            instanceTileMesh.mesh.dispose();
        }
        this.instancedTileMeshes.clear();
        this.material.dispose();
        this.shadowMaterial.dispose();
    }

    public isInvisibleSince(): number | null {
        return this.invisibleSinceTimestamp;
    }

    public get wireframe(): boolean {
        return this.material.wireframe;
    }

    public set wireframe(wireframe: boolean) {
        this.material.wireframe = wireframe;
        this.shadowMaterial.wireframe = wireframe;
    }
}

export { HeightmapRootTile, type Parameters };
