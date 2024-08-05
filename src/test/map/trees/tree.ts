import * as THREE from 'three';

import { type IHeightmapSample, type VoxelsChunkData } from '../../../lib';
import { colorMapping } from '../color-mapping';

const keyColors = {
    treeTrunk: { color: new THREE.Color('#692D00') },
    treeLeaves: { color: new THREE.Color('#007A00') },
};

class Tree {
    public readonly radiusXZ: number;
    public readonly offset: THREE.Vector3Like;

    private readonly voxels: VoxelsChunkData;
    private readonly indexFactor: THREE.Vector3Like;

    private readonly fromAbove: Array<IHeightmapSample | null>;

    public constructor() {
        this.radiusXZ = 4;
        const trunkHeight = 6;

        const size = new THREE.Vector3(1 + 2 * this.radiusXZ, trunkHeight + 2 * this.radiusXZ + 1, 1 + 2 * this.radiusXZ);
        this.voxels = {
            size,
            isEmpty: false,
            data: new Uint16Array(size.x * size.y * size.z),
        };
        this.indexFactor = { x: 1, y: size.x, z: size.x * size.y };
        this.offset = new THREE.Vector3(-this.radiusXZ, 0, -this.radiusXZ);

        // fill voxels
        const trunkMaterialId = colorMapping.getMaterialId(keyColors.treeTrunk.color);
        const trunkVoxelData = trunkMaterialId + 1;
        for (let iY = 0; iY <= trunkHeight; iY++) {
            const index = this.buildIndex({ x: this.radiusXZ, y: iY, z: this.radiusXZ });
            this.voxels.data[index] = trunkVoxelData;
        }

        const leavesMaterialId = colorMapping.getMaterialId(keyColors.treeLeaves.color);
        const leavesVoxelData = leavesMaterialId + 1;
        const canopeeCenter = new THREE.Vector3(this.radiusXZ, trunkHeight + this.radiusXZ, this.radiusXZ);
        const pos = { x: 0, y: 0, z: 0 };
        for (pos.z = 0; pos.z < this.size.z; pos.z++) {
            for (pos.y = 0; pos.y < this.size.y; pos.y++) {
                for (pos.x = 0; pos.x < this.size.x; pos.x++) {
                    if (canopeeCenter.distanceTo(pos) < this.radiusXZ) {
                        const index = this.buildIndex(pos);
                        this.voxels.data[index] = leavesVoxelData;
                    }
                }
            }
        }

        // compute view from above
        this.fromAbove = [];
        for (pos.z = 0; pos.z < this.size.z; pos.z++) {
            for (pos.x = 0; pos.x < this.size.x; pos.x++) {
                let sample: IHeightmapSample | null = null;
                for (pos.y = this.size.y - 1; pos.y >= 0; pos.y--) {
                    const voxelData = this.getVoxel(pos);
                    if (voxelData) {
                        sample = {
                            altitude: pos.y,
                            color: colorMapping.getColor(voxelData),
                        };
                        break;
                    }
                }
                this.fromAbove.push(sample);
            }
        }
    }

    public get size(): THREE.Vector3Like {
        return this.voxels.size;
    }

    public getVoxel(position: THREE.Vector3Like): number | null {
        const index = this.buildIndex(position);
        const voxel = this.voxels.data[index];
        if (typeof voxel === 'undefined') {
            throw new Error();
        }
        if (voxel === 0) {
            return null;
        }
        return (voxel - 1) as number;
    }

    public getHeightmapSample(position: THREE.Vector2Like): IHeightmapSample | null {
        const x = Math.floor(position.x);
        const z = Math.floor(position.y);
        if (x < 0 || z < 0 || x >= this.size.x || z >= this.size.z) {
            return null;
        }
        const index = x + z * this.size.x;
        const sample = this.fromAbove[index];
        if (typeof sample === 'undefined') {
            throw new Error();
        }
        return sample;
    }

    private buildIndex(position: THREE.Vector3Like): number {
        if (position.x < 0 || position.y < 0 || position.z < 0) {
            throw new Error();
        }
        return position.x * this.indexFactor.x + position.y * this.indexFactor.y + position.z * this.indexFactor.z;
    }
}

export { Tree };
