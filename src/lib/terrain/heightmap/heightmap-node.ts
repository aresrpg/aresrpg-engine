import { logger } from "../../helpers/logger";
import * as THREE from "../../three-usage";
import { HeightmapNodeId } from "./heightmap-node-id";

type Children = {
    readonly mm: HeightmapNode,
    readonly mp: HeightmapNode,
    readonly pm: HeightmapNode,
    readonly pp: HeightmapNode,
};

let trianglesCount = 0;

const baseGeometry = (() => {
    const voxelRatio = 4;
    const voxelsCount = HeightmapNodeId.smallestLevelSizeInVoxels;
    const quadsCount = voxelsCount / voxelRatio;
    const geometryData: number[] = [];
    for (let iX = 0; iX <= quadsCount; iX++) {
        for (let iY = 0; iY <= quadsCount; iY++) {
            geometryData.push(voxelRatio * iX, 0, voxelRatio * iY);
        }
    }

    const buildIndex = (x: number, y: number) => y + x * (quadsCount + 1);
    const indexData: number[] = [];
    for (let iX = 0; iX < quadsCount; iX++) {
        for (let iY = 0; iY < quadsCount; iY++) {
            const mm = buildIndex(iX + 0, iY + 0);
            const mp = buildIndex(iX + 0, iY + 1);
            const pm = buildIndex(iX + 1, iY + 0);
            const pp = buildIndex(iX + 1, iY + 1);
            indexData.push(mm, pp, pm, mm, mp, pp)
            trianglesCount += 2;
        }
    }

    return { geometryData, indexData };
})();

class HeightmapNode {
    private static readonly material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, wireframe: true });

    public readonly container: THREE.Object3D;

    private readonly mesh: THREE.Mesh;
    private children: Children | null = null;

    private readonly root: HeightmapNode | null = null;
    private readonly id: HeightmapNodeId;

    public constructor(id: HeightmapNodeId, root?: HeightmapNode) {
        this.id = id;
        if (root) {
            this.root = root;
        }

        const levelScaling = (1 << this.id.level);
        const geometryData = baseGeometry.geometryData.map(value => {
            return levelScaling * value;
        });

        const geometryPositionAttribute = new THREE.Float32BufferAttribute(geometryData, 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", geometryPositionAttribute);
        geometry.setIndex(baseGeometry.indexData);

        const nodeIdAsString = id.asString();
        this.mesh = new THREE.Mesh(geometry, HeightmapNode.material);
        this.mesh.name = `Heightmap node mesh ${nodeIdAsString}`;
        const firstVoxelPosition = this.id.box.min;
        this.mesh.position.set(firstVoxelPosition.x, 0, firstVoxelPosition.y);

        this.container = new THREE.Group();
        this.container.name = `Heightmap node ${nodeIdAsString}`;
        this.container.add(this.mesh);
    }

    public getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        if (this.id.equals(nodeId)) {
            return this;
        } else if (nodeId.level >= this.id.level) {
            // node cannot be not a child of this
            return null;
        }

        if (this.id.contains(nodeId)) {
            if (!this.children) {
                this.split();
            }
            const children = this.children;
            if (!children) {
                throw new Error();
            }
            for (const child of this.childrenList) {
                const result = child.getSubNode(nodeId);
                if (result) {
                    return result;
                }
            }
            throw new Error();
        }

        return null;
    }

    public dispose(): void {
        this.container.clear();

        this.mesh.geometry.dispose();

        if (this.children) {
            for (const child of this.childrenList) {
                child.dispose();
            }
        }
    }

    private split(): void {
        if (this.children || this.id.level <= 0) {
            logger.warn("Cannot split heightmap node");
            return;
        }

        if (this.root) {
            this.root.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x - 1, y: this.id.coordsInLevel.y + 0 }));
            this.root.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 1, y: this.id.coordsInLevel.y + 0 }));
            this.root.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 0, y: this.id.coordsInLevel.y - 1 }));
            this.root.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 0, y: this.id.coordsInLevel.y + 1 }));
        }

        const childrenLevel = this.id.level - 1;
        const subLevelBaseCoords = new THREE.Vector2().copy(this.id.coordsInLevel).multiplyScalar(2);
        const root = this.root || this;

        this.children = {
            mm: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 0, y: subLevelBaseCoords.y + 0 }), root),
            pm: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 1, y: subLevelBaseCoords.y + 0 }), root),
            mp: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 0, y: subLevelBaseCoords.y + 1 }), root),
            pp: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 1, y: subLevelBaseCoords.y + 1 }), root),
        };

        this.container.clear();
        for (const child of this.childrenList) {
            this.container.add(child.container);
        }
    }

    private get childrenList(): HeightmapNode[] {
        if (this.children) {
            return Object.values(this.children);
        }
        return [];
    }
}

export {
    HeightmapNode
};

