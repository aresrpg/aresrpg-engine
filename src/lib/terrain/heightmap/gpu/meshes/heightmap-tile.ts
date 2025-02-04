import { AsyncTask } from '../../../../helpers/async/async-task';
import { applyReplacements } from '../../../../helpers/string';
import * as THREE from '../../../../libs/three-usage';
import { type IHeightmap, type IHeightmapSample } from '../../i-heightmap';

import { type HeightmapRootTexture, type TileId } from './heightmap-root-texture';
import { buildEdgesResolutionId, type EdgesResolution, EEdgeResolution, type TileGeometryStore } from './tile-geometry-store';

type Children = {
    readonly mm: HeightmapTile;
    readonly mp: HeightmapTile;
    readonly pm: HeightmapTile;
    readonly pp: HeightmapTile;
};

type Parameters = {
    readonly root: {
        readonly heightmap: IHeightmap;
        readonly geometryStore: TileGeometryStore;
        readonly texture: HeightmapRootTexture;
        convertToWorldPositions(localTileId: TileId, normalizedPositions: Float32Array): Float32Array;
        getWorldSize(nestingLevel: number): number;
    };
    readonly localTileId: TileId;
    readonly flatShading: boolean;
};

type TileEdgesDrop = {
    readonly up: boolean;
    readonly down: boolean;
    readonly left: boolean;
    readonly right: boolean;
    readonly upLeft: boolean;
    readonly upRight: boolean;
    readonly downLeft: boolean;
    readonly downRight: boolean;
};

class HeightmapTile {
    public readonly container: THREE.Object3D;

    private readonly childrenContainer: THREE.Object3D;
    private readonly selfContainer: THREE.Object3D;

    protected readonly root: {
        readonly heightmap: IHeightmap;
        readonly geometryStore: TileGeometryStore;
        readonly texture: HeightmapRootTexture;
        convertToWorldPositions(localTileId: TileId, normalizedPositions: Float32Array): Float32Array;
        getWorldSize(nestingLevel: number): number;
    };

    private readonly self: {
        readonly localTileId: TileId;
        readonly shader: {
            readonly material: THREE.MeshPhongMaterial;
            readonly shadowMaterial: THREE.Material;
            readonly uniforms: {
                readonly uDropUp: THREE.IUniform<number>;
                readonly uDropDown: THREE.IUniform<number>;
                readonly uDropLeft: THREE.IUniform<number>;
                readonly uDropRight: THREE.IUniform<number>;
                readonly uDropDownLeft: THREE.IUniform<number>;
                readonly uDropDownRight: THREE.IUniform<number>;
                readonly uDropUpLeft: THREE.IUniform<number>;
                readonly uDropUpRight: THREE.IUniform<number>;
            };
        };
        readonly meshes: Map<string, THREE.Mesh>;
    };

    private readonly flatShading: boolean;

    private dataQuery: AsyncTask<IHeightmapSample[]> | null;

    private subdivided: boolean = false;
    public children: Children | null = null;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmap-tile';

        this.childrenContainer = new THREE.Group();
        this.childrenContainer.name = 'children';

        this.selfContainer = new THREE.Group();
        this.selfContainer.name = 'self';
        this.selfContainer.visible = false;
        this.container.add(this.selfContainer);

        this.root = params.root;
        this.flatShading = params.flatShading;

        const uvChunk = this.root.texture.getTileUv(params.localTileId);
        const uniforms = {
            uTexture0: { value: this.root.texture.textures.colorAndAltitude },
            uTexture1: { value: this.root.texture.textures.normals },
            uUvScale: { value: uvChunk.scale },
            uUvShift: { value: new THREE.Vector2().copy(uvChunk.shift) },
            uMinAltitude: { value: this.root.heightmap.minAltitude },
            uMaxAltitude: { value: this.root.heightmap.maxAltitude },
            uSizeWorld: { value: this.root.getWorldSize(params.localTileId.nestingLevel) },
            uDropUp: { value: 0 },
            uDropDown: { value: 0 },
            uDropLeft: { value: 0 },
            uDropRight: { value: 0 },
            uDropDownLeft: { value: 0 },
            uDropDownRight: { value: 0 },
            uDropUpLeft: { value: 0 },
            uDropUpRight: { value: 0 },
        };

        const hasNormalsTexture = !!this.root.texture.textures.normals;
        const material = new THREE.MeshPhongMaterial({ vertexColors: true });
        material.shininess = 0;
        material.flatShading = this.flatShading;
        material.customProgramCacheKey = () => `heightmap-tile-material-normals=${hasNormalsTexture}`;
        material.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
uniform sampler2D uTexture0;
uniform vec2 uUvShift;
uniform float uUvScale;
uniform float uMinAltitude;
uniform float uMaxAltitude;

uniform float uDropUp;
uniform float uDropDown;
uniform float uDropLeft;
uniform float uDropRight;
uniform float uDropDownLeft;
uniform float uDropDownRight;
uniform float uDropUpLeft;
uniform float uDropUpRight;

void main() {
    vec2 tileUv = uUvShift + position.xz * uUvScale;
    vec4 texture0Sample = texture(uTexture0, tileUv);
`,
                '#include <begin_vertex>': `
vec3 transformed = position;
float altitude = texture0Sample.a;
transformed.y = mix(uMinAltitude, uMaxAltitude, altitude);

float isUp = step(0.99, position.z);
float isDown = step(position.z, 0.01);
float isLeft = step(position.x, 0.01);
float isRight = step(0.99, position.x);
float drop = step(0.5,
    isUp * uDropUp +
    isDown * uDropDown +
    isLeft * uDropLeft +
    isRight * uDropRight +
    isDown * (isLeft * uDropDownLeft + isRight * uDropDownRight) +
    isUp * (isLeft * uDropUpLeft + isRight * uDropUpRight)
);
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
                uniform float uSizeWorld;

                void main() {`,
                    '#include <beginnormal_vertex>': `
                vec4 texture1Sample = texture(uTexture1, tileUv);
                vec3 objectNormal = 2.0 * texture1Sample.rgb - 1.0;
                objectNormal.y /= uSizeWorld;
                `,
                });
            }
        };

        // Custom shadow material using RGBA depth packing.
        // A custom material for shadows is needed here, because the geometry is created inside the vertex shader,
        // so the builtin threejs shadow material will not work.
        // Written like:
        // https://github.com/mrdoob/three.js/blob/2ff77e4b335e31c108aac839a07401664998c730/src/renderers/shaders/ShaderLib/depth.glsl.js#L47
        const shadowMaterial = new THREE.ShaderMaterial({
            glslVersion: '300 es',
            uniforms,
            vertexShader: `
                uniform sampler2D uTexture0;
                uniform vec2 uUvShift;
                uniform float uUvScale;
                uniform float uMinAltitude;
                uniform float uMaxAltitude;

                uniform float uDropUp;
                uniform float uDropDown;
                uniform float uDropLeft;
                uniform float uDropRight;
                uniform float uDropDownLeft;
                uniform float uDropDownRight;
                uniform float uDropUpLeft;
                uniform float uDropUpRight;

                out vec2 vHighPrecisionZW;

                void main() {
                    vec2 tileUv = uUvShift + position.xz * uUvScale;
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

        this.self = {
            localTileId: params.localTileId,
            shader: {
                material,
                shadowMaterial,
                uniforms,
            },
            meshes: new Map(),
        };
        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgeResolution = { up, down, left, right };
                        const bufferGeometry = this.root.geometryStore.getBufferGeometry(edgeResolution);
                        const mesh = new THREE.Mesh(bufferGeometry, this.self.shader.material);
                        mesh.customDepthMaterial = this.self.shader.shadowMaterial;
                        mesh.receiveShadow = true;
                        mesh.castShadow = true;
                        const id = buildEdgesResolutionId(edgeResolution);
                        this.self.meshes.set(id, mesh);
                    }
                }
            }
        }

        this.setEdgesResolution({
            up: EEdgeResolution.SIMPLE,
            down: EEdgeResolution.SIMPLE,
            left: EEdgeResolution.SIMPLE,
            right: EEdgeResolution.SIMPLE,
        });

        this.dataQuery = new AsyncTask(async () => {
            const worldCoords = this.root.convertToWorldPositions(this.self.localTileId, this.root.texture.tilePositions);
            return await this.root.heightmap.sampleHeightmap(worldCoords);
        });
    }

    public subdivide(): void {
        if (!this.children) {
            const createAndAttachChild = (x: 0 | 1, z: 0 | 1): HeightmapTile => {
                const childTile = new HeightmapTile({
                    root: this.root,
                    localTileId: {
                        nestingLevel: this.self.localTileId.nestingLevel + 1,
                        localCoords: {
                            x: 2 * this.self.localTileId.localCoords.x + x,
                            z: 2 * this.self.localTileId.localCoords.z + z,
                        },
                    },
                    flatShading: this.flatShading,
                });
                childTile.container.applyMatrix4(new THREE.Matrix4().makeTranslation(x, 0, z));
                childTile.container.applyMatrix4(new THREE.Matrix4().makeScale(0.5, 1, 0.5));
                childTile.wireframe = this.wireframe;
                this.childrenContainer.add(childTile.container);
                return childTile;
            };

            this.children = {
                mm: createAndAttachChild(0, 0),
                mp: createAndAttachChild(0, 1),
                pm: createAndAttachChild(1, 0),
                pp: createAndAttachChild(1, 1),
            };
        }

        this.subdivided = true;
        this.container.clear();
        this.container.add(this.childrenContainer);
    }

    public merge(): void {
        this.subdivided = false;
        this.container.clear();
        this.container.add(this.selfContainer);
    }

    public dispose(): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.dispose();
            }
            this.children = null;
        }
        this.childrenContainer.clear();

        for (const selfMesh of this.self.meshes.values()) {
            const selfMeshMaterial = selfMesh.material;
            if (Array.isArray(selfMeshMaterial)) {
                for (const material of selfMeshMaterial) {
                    material.dispose();
                }
            } else {
                selfMeshMaterial.dispose();
            }
        }
        this.self.meshes.clear();
        this.selfContainer.clear();

        this.container.clear();
    }

    public setEdgesResolution(edgesResolution: EdgesResolution): void {
        const id = buildEdgesResolutionId(edgesResolution);
        const mesh = this.self.meshes.get(id);
        if (!mesh) {
            throw new Error();
        }

        this.selfContainer.clear();
        this.selfContainer.add(mesh);
    }

    public setEdgesDrop(edgesDrop: TileEdgesDrop): void {
        this.self.shader.uniforms.uDropUp.value = +edgesDrop.up;
        this.self.shader.uniforms.uDropDown.value = +edgesDrop.down;
        this.self.shader.uniforms.uDropLeft.value = +edgesDrop.left;
        this.self.shader.uniforms.uDropRight.value = +edgesDrop.right;
        this.self.shader.uniforms.uDropDownLeft.value = +edgesDrop.downLeft;
        this.self.shader.uniforms.uDropDownRight.value = +edgesDrop.downRight;
        this.self.shader.uniforms.uDropUpLeft.value = +edgesDrop.upLeft;
        this.self.shader.uniforms.uDropUpRight.value = +edgesDrop.upRight;
    }

    public setVisibility(visible: boolean): void {
        this.container.visible = visible;
    }

    public get wireframe(): boolean {
        return this.self.shader.material.wireframe;
    }

    public set wireframe(wireframe: boolean) {
        if (this.wireframe !== wireframe) {
            this.self.shader.material.wireframe = wireframe;

            if (this.children) {
                for (const child of Object.values(this.children)) {
                    child.wireframe = wireframe;
                }
            }
        }
    }

    public update(renderer: THREE.WebGLRenderer): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.update(renderer);
            }
        }

        if (!this.subdivided) {
            if (this.dataQuery && !this.dataQuery.isStarted) {
                if (this.root.texture.hasOptimalDataForTile(this.self.localTileId)) {
                    this.dataQuery = null; // we already have precise enough data for this tile
                } else {
                    this.dataQuery.start();
                }
            }

            if (!this.selfContainer.visible && this.root.texture.hasDataForTile(this.self.localTileId)) {
                this.selfContainer.visible = true;
            }
        }

        if (this.dataQuery?.isFinished) {
            const samples = this.dataQuery.getResultSync();
            this.root.texture.renderTile(this.self.localTileId, renderer, samples);
            this.dataQuery = null;
        }
    }
}

export { HeightmapTile, type Parameters, type TileEdgesDrop };
