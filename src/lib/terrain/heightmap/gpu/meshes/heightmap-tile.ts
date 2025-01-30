import * as THREE from '../../../../libs/three-usage';

import { buildHeightmapTileMaterial } from './heightmap-tile-material';
import { buildEdgesResolutionId, type EdgesResolution, EEdgeResolution, type TileGeometryStore } from './tile-geometry-store';

type Children = {
    readonly mm: HeightmapTile;
    readonly mp: HeightmapTile;
    readonly pm: HeightmapTile;
    readonly pp: HeightmapTile;
};

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly data: {
        readonly texture: THREE.Texture;
        readonly elevationScale: number;
        readonly uv: {
            readonly scale: number;
            readonly shift: THREE.Vector2Like;
        };
    };
};

class HeightmapTile {
    public readonly container: THREE.Object3D;

    private readonly childrenContainer: THREE.Object3D;
    private readonly selfContainer: THREE.Object3D;

    private readonly geometryStore: TileGeometryStore;

    private readonly selfMaterial: THREE.ShaderMaterial;
    private readonly selfMeshes: Map<string, THREE.Mesh>;

    private readonly data: {
        readonly texture: THREE.Texture;
        readonly elevationScale: number;
    };

    private readonly uv: {
        readonly scale: number;
        readonly shift: THREE.Vector2Like;
    };

    public children: Children | null = null;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmap-tile';

        this.childrenContainer = new THREE.Group();
        this.childrenContainer.name = 'children';

        this.selfContainer = new THREE.Group();
        this.selfContainer.name = 'self';
        this.container.add(this.selfContainer);

        this.geometryStore = params.geometryStore;

        this.data = { ...params.data };
        this.uv = { ...params.data.uv };

        this.selfMaterial = buildHeightmapTileMaterial(this.data.texture, this.data.elevationScale, this.uv.scale, this.uv.shift);
        this.selfMeshes = new Map();
        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgeResolution = { up, down, left, right };
                        const bufferGeometry = params.geometryStore.getBufferGeometry(edgeResolution);
                        const mesh = new THREE.Mesh(bufferGeometry, this.selfMaterial);
                        const id = buildEdgesResolutionId(edgeResolution);
                        this.selfMeshes.set(id, mesh);
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
    }

    public subdivide(): void {
        if (!this.children) {
            const createAndAttachChild = (x: 0 | 1, z: 0 | 1): HeightmapTile => {
                const childUvScale = this.uv.scale / 2;
                const childTile = new HeightmapTile({
                    geometryStore: this.geometryStore,
                    data: {
                        texture: this.data.texture,
                        elevationScale: this.data.elevationScale,
                        uv: {
                            scale: childUvScale,
                            shift: new THREE.Vector2().copy(this.uv.shift).add({ x: x * childUvScale, y: z * childUvScale }),
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
        this.container.clear();
        this.container.add(this.childrenContainer);
    }

    public merge(): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.dispose();
            }
        }
        this.children = null;
        this.childrenContainer.clear();

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

        for (const selfMesh of this.selfMeshes.values()) {
            const selfMeshMaterial = selfMesh.material;
            if (Array.isArray(selfMeshMaterial)) {
                for (const material of selfMeshMaterial) {
                    material.dispose();
                }
            } else {
                selfMeshMaterial.dispose();
            }
        }
        this.selfMeshes.clear();
        this.selfContainer.clear();

        this.container.clear();
    }

    public setEdgesResolution(edgesResolution: EdgesResolution): void {
        const id = buildEdgesResolutionId(edgesResolution);
        const mesh = this.selfMeshes.get(id);
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
        return this.selfMaterial.wireframe;
    }

    public set wireframe(wireframe: boolean) {
        if (this.wireframe !== wireframe) {
            this.selfMaterial.wireframe = wireframe;

            if (this.children) {
                for (const child of Object.values(this.children)) {
                    child.wireframe = wireframe;
                }
            }
        }
    }
}

export { HeightmapTile, type Parameters };
