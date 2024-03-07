import * as THREE from "three";
import { IVoxel, VoxelOctreeBase } from "./voxel-octree-base";

class VoxelOctreeLeaf extends VoxelOctreeBase {
    public static readonly size = 64;

    private readonly data: Uint16Array;
    private readonly maxMaterialId: number;
    private totalVoxelsCount = 0;

    public constructor(from: THREE.Vector3) {
        super(from, VoxelOctreeLeaf.size);

        this.data = new Uint16Array(this.size * this.size * this.size);
        this.maxMaterialId = (1 << (8 * this.data.BYTES_PER_ELEMENT)) - 2;
    }

    public get voxelsCount(): number {
        return this.totalVoxelsCount;
    }

    public setVoxelMaterial(voxelId: THREE.Vector3, material: number): void {
        if (material < 0 || material > this.maxMaterialId) {
            throw new Error(`Out of range material "${material}"`);
        }

        const index = this.buildIndex(voxelId);
        if (this.data[index] === 0) { // this is a new voxel
            this.totalVoxelsCount++;
        }
        this.data[index] = 1 + material;
    }

    public getVoxelMaterial(voxelId: THREE.Vector3): number | null {
        const index = this.buildIndex(voxelId);
        const data = this.data[index];
        if (typeof data === "undefined") {
            throw new Error();
        }

        if (data === 0) {
            return null; // no voxel
        }
        const material = data - 1;
        return material;
    }

    public *iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel> {
        let index = 0;
        const position = new THREE.Vector3();
        for (position.z = from.z; position.z < this.to.z && position.z < to.z; position.z++) {
            for (position.y = from.y; position.y < this.to.y && position.y < to.y; position.y++) {
                for (position.x = from.x; position.x < this.to.x && position.x < to.x; position.x++) {
                    const materialId = this.data[index++]! - 1;
                    if (materialId >= 0) {
                        yield { position, materialId };
                    }
                }
            }
        }
    }

    private buildIndex(voxelId: THREE.Vector3): number {
        if (!this.isInBounds(voxelId)) {
            throw new Error(`Out of range voxel id ${voxelId.x}x${voxelId.y}x${voxelId.z}`);
        }
        const localId = voxelId.clone().sub(this.from);
        return localId.x + VoxelOctreeLeaf.size * (localId.y + VoxelOctreeLeaf.size * localId.z);
    }
}

export {
    VoxelOctreeLeaf
};

