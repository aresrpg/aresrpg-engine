import * as THREE from "three";
import { IVoxel, VoxelOctreeBase } from "./voxel-octree-base";
import { VoxelOctreeLeaf } from "./voxel-octree-leaf";

class VoxelOctree extends VoxelOctreeBase {
    public static create(wantedSize: number): VoxelOctreeBase {
        return VoxelOctree.createSubtree(new THREE.Vector3(0, 0, 0), wantedSize);
    }

    private static createSubtree(from: THREE.Vector3, wantedSize: number): VoxelOctreeBase {
        const maxSize = (1 << 30);
        if (wantedSize <= 0 || wantedSize >= maxSize) {
            throw new Error(`Octree size must be > 0 (received ${wantedSize})`);
        }
        let actualSize = VoxelOctreeLeaf.size;
        while (actualSize < wantedSize) {
            actualSize = actualSize << 1;
        }

        if (actualSize === VoxelOctreeLeaf.size) {
            return new VoxelOctreeLeaf(from);
        }
        return new VoxelOctree(from, actualSize);
    }

    private readonly subtrees: Record<string, VoxelOctreeBase | null> = {
        mmm: null,
        mmp: null,
        mpm: null,
        mpp: null,
        pmm: null,
        pmp: null,
        ppm: null,
        ppp: null,
    };

    private constructor(from: THREE.Vector3, size: number) {
        super(from, size);
    }

    public setVoxelMaterial(voxelId: THREE.Vector3, material: number): void {
        if (!this.isInBounds(voxelId)) {
            throw new Error();
        }

        const subTree = this.getSubTree(voxelId);
        if (!subTree) {
            throw new Error(`Out of bounds ${voxelId.x}x${voxelId.y}x${voxelId.z}`);
        }
        subTree.setVoxelMaterial(voxelId, material);
    }

    public getVoxelMaterial(voxelId: THREE.Vector3): number | null {
        const subTree = this.getSubTree(voxelId);
        if (!subTree) {
            return null;
        }
        return subTree.getVoxelMaterial(voxelId);
    }

    public get voxelsCount(): number {
        let voxelsCount = 0;
        for (const subTree of Object.values(this.subtrees)) {
            if (subTree) {
                voxelsCount += subTree.voxelsCount;
            }
        }
        return voxelsCount;
    }

    public *iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel> {
        for (const subtree of Object.values(this.subtrees)) {
            if (subtree) {
                for (const voxel of subtree.iterateOnVoxels(from, to)) {
                    yield voxel;
                }
            }
        }
    }

    private getSubTree(voxelId: THREE.Vector3): VoxelOctreeBase | null {
        const isLowerX = (voxelId.x < this.midVoxel.x);
        const isLowerY = (voxelId.y < this.midVoxel.y);
        const isLowerZ = (voxelId.z < this.midVoxel.z);

        const subtreeIdParts: [string, string, string] = ["m", "m", "m"];
        const from = this.from.clone();

        if (!isLowerX) {
            subtreeIdParts[0] = "p";
            from.x = this.midVoxel.x;
        }
        if (!isLowerY) {
            subtreeIdParts[1] = "p";
            from.y = this.midVoxel.y;
        }
        if (!isLowerZ) {
            subtreeIdParts[2] = "p";
            from.z = this.midVoxel.z;
        }

        const subtreeId = subtreeIdParts.join("");
        let subtree = this.subtrees[subtreeId];
        if (typeof subtree === "undefined") {
            throw new Error();
        }
        if (!subtree) {
            subtree = VoxelOctree.createSubtree(from, this.halfSize);
            this.subtrees[subtreeId] = subtree;
        }
        return subtree;
    }
}

export {
    VoxelOctree as VoxelOctree
};

