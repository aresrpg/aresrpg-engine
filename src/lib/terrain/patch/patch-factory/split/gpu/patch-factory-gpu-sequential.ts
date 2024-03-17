import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode, type GeometryAndMaterial } from '../../patch-factory-base';
import * as THREE from '../../../../../three-usage';

import { PatchFactoryGpu } from './patch-factory-gpu';

class PatchFactoryGpuSequential extends PatchFactoryGpu {
    private readonly gpuSequentialLimiter = new PromiseThrottler(1);

    public constructor(map: IVoxelMap) {
        super(map, EPatchComputingMode.GPU_SEQUENTIAL);
    }

    protected async computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        return this.gpuSequentialLimiter.run(async () => {
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return [];
            }

            const localMapCache = this.buildLocalMapCache(patchStart, patchEnd);

            const patchComputerGpu = await this.patchComputerGpuPromise;
            if (!patchComputerGpu) {
                throw new Error('Could not get WebGPU patch computer');
            }
            const buffers = await patchComputerGpu.computeBuffers(localMapCache);
            return this.assembleGeometryAndMaterials(buffers);
        });
    }
}

export { PatchFactoryGpuSequential };
