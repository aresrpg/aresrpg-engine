import * as THREE from '../../../../libs/three-usage';

import { buildEdgesResolutionId, type EdgesResolution, EEdgeResolution, type TileGeometryStore } from './tile-geometry-store';

type Children = {
    readonly mm: HeightmapTile;
    readonly mp: HeightmapTile;
    readonly pm: HeightmapTile;
    readonly pp: HeightmapTile;
};

type Parameters = {
    readonly geometryStore: TileGeometryStore;
};

class HeightmapTile {
    public readonly container: THREE.Object3D;

    private readonly childrenContainer: THREE.Object3D;
    private readonly selfContainer: THREE.Object3D;

    private readonly geometryStore: TileGeometryStore;

    private readonly selfMeshes: Map<string, THREE.Mesh>;

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

        this.selfMeshes = new Map();
        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgeResolution = { up, down, left, right };
                        const bufferGeometry = params.geometryStore.getBufferGeometry(edgeResolution);
                        const mesh = new THREE.Mesh(bufferGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
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
            const createAndAttachChild = (shiftX: boolean, shiftY: boolean): HeightmapTile => {
                const childTile = new HeightmapTile({ geometryStore: this.geometryStore });
                childTile.container.applyMatrix4(new THREE.Matrix4().makeTranslation(+shiftX, 0, +shiftY));
                childTile.container.applyMatrix4(new THREE.Matrix4().makeScale(0.5, 1, 0.5));
                this.childrenContainer.add(childTile.container);
                return childTile;
            };

            this.children = {
                mm: createAndAttachChild(false, false),
                mp: createAndAttachChild(false, true),
                pm: createAndAttachChild(true, false),
                pp: createAndAttachChild(true, true),
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
}

export { HeightmapTile, type Parameters };
