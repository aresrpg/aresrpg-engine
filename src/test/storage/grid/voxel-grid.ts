import type { IVoxelStorage } from "../i-voxel-storage";
import { IVoxel, VoxelGridData } from "./voxel-grid-data";

class VoxelGrid implements IVoxelStorage {
    private readonly dataBlocks: Record<string, VoxelGridData> = {};

    public setVoxelMaterial(coords: THREE.Vector3, materialId: number): void {
        const blockId = this.buildBlockId(coords);
        const blockIdString = this.buildBlockStringId(blockId);

        let dataBlock = this.dataBlocks[blockIdString];
        if (!dataBlock) {
            dataBlock = new VoxelGridData(blockId.multiplyScalar(VoxelGridData.size));
            this.dataBlocks[blockIdString] = dataBlock;
        }
        dataBlock.setVoxelMaterial(coords, materialId);
    }

    public *iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel> {
        for (const block of Object.values(this.dataBlocks)) {
            if ((from.x < block.to.x && to.x >= block.from.x) &&
                (from.y < block.to.y && to.y >= block.from.y) &&
                (from.z < block.to.z && to.z >= block.from.z)) {
                for (const voxel of block.iterateOnVoxels(from, to)) {
                    yield voxel;
                }
            }
        }
    }

    public doesVoxelExist(coords: THREE.Vector3): boolean {
        const blockId = this.buildBlockId(coords);
        const blockIdString = this.buildBlockStringId(blockId);
        const dataBlock = this.dataBlocks[blockIdString];
        if (typeof dataBlock === "undefined") {
            return false;
        }
        return dataBlock.doesVoxelExist(coords);
    }

    private buildBlockId(coords: THREE.Vector3): THREE.Vector3 {
        return coords.clone().divideScalar(VoxelGridData.size).floor();
    }

    private buildBlockStringId(blockId: THREE.Vector3): string {
        return `${blockId.x}_${blockId.y}_${blockId.z}`;
    }
}

export {
    VoxelGrid
};

