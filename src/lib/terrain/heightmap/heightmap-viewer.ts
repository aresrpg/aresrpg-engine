import * as THREE from '../../libs/three-usage';

import { type MeshesStatistics } from '../../helpers/meshes-statistics';

import { HeightmapNodeId } from './heightmap-node-id';
import { HeightmapRoot, type HeightmapRootOptions } from './heightmap-root';
import { type IHeightmap } from './i-heightmap';

type HeightmapStatistics = MeshesStatistics;

type HeightmapViewerOptions = HeightmapRootOptions;

class HeightmapViewer {
    public readonly container: THREE.Object3D;

    public readonly basePatchSize: number;

    public focusPoint: THREE.Vector2Like = { x: 0, y: 0 };
    public focusDistance: number = 50;
    public visibilityDistance: number = 2000;

    private readonly root: HeightmapRoot;

    public constructor(sampler: IHeightmap, options: HeightmapViewerOptions) {
        this.container = new THREE.Group();
        this.container.name = 'Heightmap container';

        this.basePatchSize = options.basePatchSize;

        this.root = new HeightmapRoot(sampler, options);
        this.container.add(this.root.container);
    }

    public setHiddenPatches(patches: ReadonlyArray<{ x: number; z: number }>): void {
        this.resetSubdivisions();
        for (const completeChunksColumn of patches) {
            this.hidePatch(completeChunksColumn.x, completeChunksColumn.z);
        }
        this.applyVisibility();
        this.updateMesh();
    }

    private resetSubdivisions(): void {
        this.root.resetSubdivisions();
    }

    private hidePatch(x: number, y: number): void {
        const patchCentralVoxel = new THREE.Vector2(x, y).addScalar(0.5).multiplyScalar(this.root.basePatchSize);
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

    private applyVisibility(): void {
        this.root.applyVisibility(this.focusPoint, this.visibilityDistance);

        const centralPatchId = this.getPatchId(new THREE.Vector2().copy(this.focusPoint));
        const delta = Math.ceil(this.focusDistance / this.root.basePatchSize);
        for (let dX = -delta; dX <= delta; dX++) {
            for (let dY = -delta; dY <= delta; dY++) {
                this.root.getOrBuildSubNode(centralPatchId.getNeighbour(dX, dY));
            }
        }
    }

    private updateMesh(): void {
        this.root.updateMesh();
    }

    public getStatistics(): HeightmapStatistics {
        return this.root.getStatistics();
    }

    public get wireframe(): boolean {
        return this.root.material.wireframe;
    }

    public set wireframe(wireframe: boolean) {
        if (this.root.material.wireframe !== wireframe) {
            this.root.material.wireframe = wireframe;
        }
    }

    private getPatchId(voxel: THREE.Vector2): HeightmapNodeId {
        const patchCoords = voxel.divideScalar(this.root.basePatchSize).floor();
        return new HeightmapNodeId(0, patchCoords, this.root);
    }
}

export { HeightmapViewer, type HeightmapStatistics };
