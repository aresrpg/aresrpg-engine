import * as THREE from '../../three-usage';

import { type HeightmapSampler } from './heightmap-node';
import { HeightmapNodeId } from './heightmap-node-id';
import { HeightmapRoot } from './heightmap-root';

class HeightmapViewer {
    public readonly container: THREE.Object3D;

    public focusPoint: THREE.Vector2Like = { x: 0, y: 0 };
    public focusDistance: number = 50;
    public visibilityDistance: number = 2000;

    private readonly root: HeightmapRoot;

    public constructor(sampler: HeightmapSampler, smallestLevelSizeInVoxels: number) {
        this.container = new THREE.Group();
        this.container.name = 'Heightmap nodes container';

        this.root = new HeightmapRoot(sampler, 5, smallestLevelSizeInVoxels);
        this.container.add(this.root.container);
    }

    public resetSubdivisions(): void {
        this.root.resetSubdivisions();
    }

    public hidePatch(x: number, y: number): void {
        const patchCentralVoxel = new THREE.Vector2(x, y).addScalar(0.5).multiplyScalar(this.root.smallestLevelSizeInVoxels);
        const patchId = this.getPatchId(patchCentralVoxel);
        const node = this.root.getOrBuildSubNode(patchId);
        if (node) {
            node.visible = false;
        }

        for (let dX = -1; dX <= 1; dX++) {
            for (let dY = -1; dY <= 1; dY++) {
                if (dX !== 0 || dY !== 0) {
                    this.root.getOrBuildSubNode(patchId.getNeighbour(dX, dY));
                }
            }
        }
    }

    public applyVisibility(): void {
        this.root.applyVisibility(this.focusPoint, this.visibilityDistance);

        const centralPatchId = this.getPatchId(new THREE.Vector2().copy(this.focusPoint));
        const delta = Math.ceil(this.focusDistance / this.root.smallestLevelSizeInVoxels);
        for (let dX = -delta; dX <= delta; dX++) {
            for (let dY = -delta; dY <= delta; dY++) {
                this.root.getOrBuildSubNode(centralPatchId.getNeighbour(dX, dY));
            }
        }
    }

    public updateMesh(): void {
        this.root.updateMesh();
    }

    private getPatchId(voxel: THREE.Vector2): HeightmapNodeId {
        const patchCoords = voxel.divideScalar(this.root.smallestLevelSizeInVoxels).floor();
        return new HeightmapNodeId(0, patchCoords, this.root);
    }
}

export { HeightmapViewer };
