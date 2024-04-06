import * as THREE from "../../three-usage";

import { HeightmapNode } from "./heightmap-node";
import { HeightmapNodeId } from "./heightmap-node-id";

class HeightmapViewer {
    public readonly container: THREE.Object3D;

    private readonly rootNode: HeightmapNode;
    private readonly shift: THREE.Vector2Like;

    public constructor() {
        this.container = new THREE.Group();
        this.container.name = "Heightmap nodes container";

        const rootLevel = 7;
        const totalSizeInVoxels = HeightmapNodeId.getLevelSizeInVoxels(rootLevel);
        this.shift = new THREE.Vector2(totalSizeInVoxels, totalSizeInVoxels).multiplyScalar(-0.5);
        const rootId = new HeightmapNodeId(
            this.shift,
            rootLevel,
            { x: 0, y: 0 }
        );
        this.rootNode = new HeightmapNode(rootId);
        this.container.add(this.rootNode.container);
    }

    public hidePatch(x: number, y: number): void {
        const patchCentralVoxel = new THREE.Vector2(x, y).addScalar(0.5).multiplyScalar(HeightmapNodeId.smallestLevelSizeInVoxels);
        const patchCoords = patchCentralVoxel.sub(this.shift).divideScalar(HeightmapNodeId.smallestLevelSizeInVoxels).ceil();
        const node = this.rootNode.getOrBuildSubNode(new HeightmapNodeId(this.shift, 0, patchCoords));
        if (node) {
            node.container.visible = false;
        }
    }

    public update(): void {
        this.rootNode.update();
    }
}

export {
    HeightmapViewer
};
