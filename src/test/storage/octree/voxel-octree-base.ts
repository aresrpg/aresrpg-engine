import * as THREE from "three";

interface IVoxel {
    readonly position: THREE.Vector3;
    readonly materialId: number;
};

abstract class VoxelOctreeBase {
    public readonly from: THREE.Vector3;
    public readonly to: THREE.Vector3;
    public readonly size: number;
    public readonly halfSize: number;
    public readonly midVoxel: THREE.Vector3;

    public abstract get voxelsCount(): number;

    public abstract setVoxelMaterial(voxelId: THREE.Vector3, material: number): void;
    public abstract getVoxelMaterial(voxelId: THREE.Vector3): number | null;
    public abstract iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel>;

    protected constructor(from: THREE.Vector3, size: number) {
        if (!VoxelOctreeBase.isPowerOfTwo(size)) {
            throw new Error();
        }

        this.from = from.clone();
        this.to = from.clone().addScalar(size);
        this.size = size;
        this.halfSize = size >> 1;
        this.midVoxel = from.clone().addScalar(this.halfSize);
    }

    public isInBounds(voxelId: THREE.Vector3): boolean {
        return voxelId.x >= this.from.x && voxelId.y >= this.from.y && voxelId.z >= this.from.z &&
            voxelId.x < this.to.x && voxelId.y < this.to.y && voxelId.z < this.to.z;
    }

    public doesVoxelExist(voxelId: THREE.Vector3): boolean {
        if (!this.isInBounds(voxelId)) {
            return false;
        }
        return this.getVoxelMaterial(voxelId) !== null;
    }

    private static isPowerOfTwo(x: number): boolean {
        for (let i = 0; i < 30; i++) {
            if (x === (1 << i)) {
                return true;
            }
        }
        return false;
    }
}

export {
    VoxelOctreeBase,
    type IVoxel,
};

