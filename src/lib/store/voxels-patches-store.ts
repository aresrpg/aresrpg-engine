import * as THREE from '../three-usage';
import { Vector3Like } from '../three-usage';

import { EVoxelsPatchLoadingStatus, VoxelsPatch, VoxelsPatchData } from './voxels-patch';

class VoxelsPatchesStore {
    public readonly patchSize: Vector3Like;

    private readonly store: Record<string, VoxelsPatch> = {};

    public constructor(patchSize: Vector3Like) {
        this.patchSize = new THREE.Vector3().copy(patchSize);
    }

    public getPatchData(patchId: Vector3Like): VoxelsPatchData | null {
        const patchIdString = this.buildPatchIdString(patchId);
        const voxelsPatch = this.store[patchIdString];

        if (voxelsPatch && voxelsPatch.loadingStatus === EVoxelsPatchLoadingStatus.LOADED) {
            return voxelsPatch.patchData;
        }

        return null;
    }

    private buildPatchIdString(patchId: Vector3Like): string {
        return `${patchId.x.toFixed()}_${patchId.y.toFixed()}_${patchId.z.toFixed()}`;
    }
}

export { VoxelsPatchesStore };
