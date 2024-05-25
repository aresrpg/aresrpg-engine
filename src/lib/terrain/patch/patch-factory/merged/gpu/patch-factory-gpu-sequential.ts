import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode, type GeometryAndMaterial } from '../../patch-factory-base';
import * as THREE from '../../../../../three-usage';
import { type PatchSize } from '../vertex-data1-encoder';

import { PatchFactoryGpu } from './patch-factory-gpu';

class PatchFactoryGpuSequential extends PatchFactoryGpu {
    private readonly gpuSequentialLimiter = new PromiseThrottler(1);

    public constructor(map: IVoxelMap, patchSize: PatchSize) {
        super(map, EPatchComputingMode.GPU_SEQUENTIAL, patchSize);
    }

    protected computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        return this.gpuSequentialLimiter.run(async () => {
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return [];
            }

            const localMapCache = await this.buildLocalMapCache(patchStart, patchEnd);
            if (localMapCache.isEmpty) {
                return [];
            }

            const patchComputerGpu = await this.getPatchComputerGpu();
            const buffer = await patchComputerGpu.computeBuffer(localMapCache);
            return this.assembleGeometryAndMaterials(buffer);
        });
    }
}

export { PatchFactoryGpuSequential };
