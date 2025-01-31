import { AsyncTask } from '../../../../helpers/async/async-task';
import * as THREE from '../../../../libs/three-usage';
import { type IHeightmapSample, type IHeightmap, type IHeightmapCoords } from '../../i-heightmap';

import { type HeightmapRootTexture, type TileId } from './heightmap-root-texture';
import { buildEdgesResolutionId, EEdgeResolution, type EdgesResolution, type TileGeometryStore } from './tile-geometry-store';

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
        convertToWorldPositions(localTileId: TileId, normalizedPositions: ReadonlyArray<IHeightmapCoords>): IHeightmapCoords[];
    };
    readonly localTileId: TileId;
};

class HeightmapTile {
    public readonly container: THREE.Object3D;

    private readonly childrenContainer: THREE.Object3D;
    private readonly selfContainer: THREE.Object3D;

    protected readonly root: {
        readonly heightmap: IHeightmap;
        readonly geometryStore: TileGeometryStore;
        readonly texture: HeightmapRootTexture;
        convertToWorldPositions(localTileId: TileId, normalizedPositions: ReadonlyArray<IHeightmapCoords>): IHeightmapCoords[];
    };

    private readonly self: {
        readonly localTileId: TileId;
        readonly material: THREE.ShaderMaterial;
        readonly meshes: Map<string, THREE.Mesh>;
    };

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

        const uvChunk = this.root.texture.getTileUv(params.localTileId);
        this.self = {
            localTileId: params.localTileId,
            material: new THREE.ShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    uElevationTexture: { value: this.root.texture.texture },
                    uUvScale: { value: uvChunk.scale },
                    uUvShift: { value: new THREE.Vector2().copy(uvChunk.shift) },
                    uMinAltitude: { value: this.root.heightmap.minAltitude },
                    uMaxAltitude: { value: this.root.heightmap.maxAltitude },
                },
                vertexShader: `
                    uniform sampler2D uElevationTexture;
                    uniform vec2 uUvShift;
                    uniform float uUvScale;
                    uniform float uMinAltitude;
                    uniform float uMaxAltitude;
            
                    out vec3 vColor;
            
                    void main() {
                        vec2 uv = uUvShift + position.xz * uUvScale;
                        vec4 textureSample = texture(uElevationTexture, uv);

                        vec3 adjustedPosition = position;
                        adjustedPosition.y = mix(uMinAltitude, uMaxAltitude, textureSample.a);
            
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(adjustedPosition, 1);
                        vColor = textureSample.rgb;
                    }
                    `,
                fragmentShader: `
                    in vec3 vColor;
            
                    out vec4 fragColor;
            
                    void main() {
                        fragColor = vec4(vColor, 1);
                    }
                    `,
            }),
            meshes: new Map(),
        };
        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgeResolution = { up, down, left, right };
                        const bufferGeometry = this.root.geometryStore.getBufferGeometry(edgeResolution);
                        const mesh = new THREE.Mesh(bufferGeometry, this.self.material);
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

    public setVisibility(visible: boolean): void {
        this.container.visible = visible;
    }

    public get wireframe(): boolean {
        return this.self.material.wireframe;
    }

    public set wireframe(wireframe: boolean) {
        if (this.wireframe !== wireframe) {
            this.self.material.wireframe = wireframe;

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
                this.dataQuery.start();
            }

            if (!this.selfContainer.visible && this.root.texture.hasFullTile(this.self.localTileId)) {
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

export { HeightmapTile, type Parameters };
