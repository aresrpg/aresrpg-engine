import * as THREE from "three";

interface IVoxel {
    readonly position: THREE.Vector3;
    readonly materialId: number;
};

class VoxelGridData {
    public static readonly size = 64;

    public readonly from: THREE.Vector3;
    public readonly to: THREE.Vector3;

    private readonly data: Uint8Array;
    private readonly maxMaterialId: number;
    private totalVoxelsCount = 0;

    public constructor(from: THREE.Vector3) {
        this.from = from.clone();
        this.to = from.clone().addScalar(VoxelGridData.size);

        this.data = new Uint8Array(VoxelGridData.size * VoxelGridData.size * VoxelGridData.size);
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
        from = from.clone().max(this.from);
        to = to.clone().min(this.to);

        const position = new THREE.Vector3();
        for (position.z = from.z; position.z < to.z; position.z++) {
            for (position.y = from.y; position.y < to.y; position.y++) {
                for (position.x = from.x; position.x < to.x; position.x++) {
                    const materialId = this.getVoxelMaterial(position);
                    if (materialId !== null) {
                        yield { position, materialId };
                    }
                }
            }
        }
    }

    public doesVoxelExist(voxelId: THREE.Vector3): boolean {
        // return this.getVoxelMaterial(voxelId) !== null;
        const index = this.buildIndex(voxelId);
        return this.data[index] !== 0;
    }

    private buildIndex(voxelId: THREE.Vector3): number {
        const localId = voxelId.clone().sub(this.from);
        if (localId.x < 0 || localId.y < 0 || localId.z < 0 ||
            localId.x >= VoxelGridData.size || localId.y >= VoxelGridData.size || localId.z >= VoxelGridData.size) {
            throw new Error(`Out of range voxel id ${voxelId.x}x${voxelId.y}x${voxelId.z}`);
        }
        return localId.x + VoxelGridData.size * (localId.y + VoxelGridData.size * localId.z);
    }
}

export {
    VoxelGridData,
    type IVoxel
};

