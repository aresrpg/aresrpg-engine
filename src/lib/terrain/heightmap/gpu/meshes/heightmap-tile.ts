import { safeModulo } from '../../../../helpers/math';
import * as THREE from '../../../../libs/three-usage';
import { type QuadtreeNodeId } from '../quadtree/quadtree-node';

import { type HeightmapRootTexture, type TileId } from './heightmap-root-texture';
import { buildEdgesResolutionId, EEdgeResolution, type EdgesResolution, type TileGeometryStore } from './tile-geometry-store';

type Children = {
    readonly mm: HeightmapTile;
    readonly mp: HeightmapTile;
    readonly pm: HeightmapTile;
    readonly pp: HeightmapTile;
};

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly rootTexture: HeightmapRootTexture;
    readonly worldNodeId: QuadtreeNodeId;
};

class HeightmapTile {
    public readonly container: THREE.Object3D;

    private readonly worldNodeId: QuadtreeNodeId;

    private readonly childrenContainer: THREE.Object3D;
    private readonly selfContainer: THREE.Object3D;

    private readonly geometryStore: TileGeometryStore;

    private readonly self: {
        readonly material: THREE.ShaderMaterial;
        readonly meshes: Map<string, THREE.Mesh>;
    };

    protected readonly root: {
        readonly texture: HeightmapRootTexture;
        readonly localTileId: TileId;
    };

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

        this.geometryStore = params.geometryStore;

        this.root = {
            texture: params.rootTexture,
            localTileId: {
                nestingLevel: params.worldNodeId.nestingLevel,
                localCoords: {
                    x: safeModulo(params.worldNodeId.worldCoordsInLevel.x, 2 ** params.worldNodeId.nestingLevel),
                    z: safeModulo(params.worldNodeId.worldCoordsInLevel.z, 2 ** params.worldNodeId.nestingLevel),
                },
            },
        };

        const uvChunk = this.root.texture.getTileUv(this.root.localTileId);
        this.self = {
            material: new THREE.ShaderMaterial({
                glslVersion: '300 es',
                uniforms: {
                    uElevationTexture: { value: this.root.texture.texture },
                    uElevationScale: { value: 1 },
                    uUvScale: { value: uvChunk.scale },
                    uUvShift: { value: new THREE.Vector2().copy(uvChunk.shift) },
                },
                vertexShader: `
                    uniform sampler2D uElevationTexture;
                    uniform vec2 uUvShift;
                    uniform float uUvScale;
                    uniform float uElevationScale;
            
                    out vec3 vColor;
            
                    void main() {
                        vec2 uv = uUvShift + position.xz * uUvScale;
            
                        vec3 adjustedPosition = position;
                        // adjustedPosition.y = texture(uElevationTexture, uv).r * uElevationScale;
            
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(adjustedPosition, 1);
                        vColor = texture(uElevationTexture, uv).rgb;
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
                        const bufferGeometry = params.geometryStore.getBufferGeometry(edgeResolution);
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

        this.worldNodeId = params.worldNodeId;
    }

    public subdivide(): void {
        if (!this.children) {
            const createAndAttachChild = (x: 0 | 1, z: 0 | 1): HeightmapTile => {
                const childTile = new HeightmapTile({
                    geometryStore: this.geometryStore,
                    rootTexture: this.root.texture,
                    worldNodeId: {
                        nestingLevel: this.worldNodeId.nestingLevel + 1,
                        worldCoordsInLevel: {
                            x: 2 * this.worldNodeId.worldCoordsInLevel.x + x,
                            z: 2 * this.worldNodeId.worldCoordsInLevel.z + z,
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

    public update(): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.update();
            }
        }

        if (!this.subdivided && !this.selfContainer.visible && this.root.texture.hasFullTile(this.root.localTileId)) {
            this.selfContainer.visible = true;
        }
    }
}

export { HeightmapTile, type Parameters };
