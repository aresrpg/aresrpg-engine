import * as THREE from "../../three-usage";

import { HeightmapNode, type HeightmapSampler } from "./heightmap-node";
import { HeightmapNodeId } from "./heightmap-node-id";

class HeightmapViewer {
    public readonly container: THREE.Object3D;

    public focusPoint: THREE.Vector2Like | null = null;
    public focusDistance: number = -1;

    private readonly rootNode: HeightmapNode;
    private readonly shift: THREE.Vector2Like;

    public constructor(sampler: HeightmapSampler) {
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
        this.rootNode = new HeightmapNode(sampler, rootId);
        this.container.add(this.rootNode.container);
    }

    public resetSubdivisions(): void {
        this.rootNode.resetSubdivisions();
    }

    public hidePatch(x: number, y: number): void {
        const patchCentralVoxel = new THREE.Vector2(x, y).addScalar(0.5).multiplyScalar(HeightmapNodeId.smallestLevelSizeInVoxels);
        const patchId = this.getPatchId(patchCentralVoxel);
        const node = this.rootNode.getOrBuildSubNode(patchId);
        if (node) {
            node.visible = false;
        }

        for (let dX = -1; dX <= 1; dX++) {
            for (let dY = -1; dY <= 1; dY++) {
                if (dX !== 0 || dY !== 0) {
                    this.rootNode.getOrBuildSubNode(new HeightmapNodeId(this.shift, 0, { x: patchId.coordsInLevel.x + dX, y: patchId.coordsInLevel.y + dY }));
                }
            }
        }
    }

    public applyFocus(): void {
        if (this.focusPoint) {
            const patchId = this.getPatchId(new THREE.Vector2().copy(this.focusPoint));
            const delta = Math.ceil(this.focusDistance / HeightmapNodeId.smallestLevelSizeInVoxels);
            for (let dX = -delta; dX <= delta; dX++) {
                for (let dY = -delta; dY <= delta; dY++) {
                    this.rootNode.getOrBuildSubNode(new HeightmapNodeId(this.shift, 0, { x: patchId.coordsInLevel.x + dX, y: patchId.coordsInLevel.y + dY }));
                }
            }
        }
    }

    public updateMesh(): void {
        this.rootNode.updateMesh();
    }

    private getPatchId(voxel: THREE.Vector2): HeightmapNodeId {
        const patchCoords = voxel.sub(this.shift).divideScalar(HeightmapNodeId.smallestLevelSizeInVoxels).floor();
        return new HeightmapNodeId(this.shift, 0, patchCoords)
    }
}

export {
    HeightmapViewer
};

