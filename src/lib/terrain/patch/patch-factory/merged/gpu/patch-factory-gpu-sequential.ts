import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import * as THREE from '../../../../../three-usage';
import { type GeometryAndMaterial } from '../../patch-factory-base';

import { PatchFactoryGpu } from './patch-factory-gpu';

class PatchFactoryGpuSequential extends PatchFactoryGpu {
    private readonly gpuSequentialLimiter = new PromiseThrottler(1);

    protected computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        return this.gpuSequentialLimiter.run(async () => {
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return [];
            }

            const localMapData = await this.buildLocalMapData(patchStart, patchEnd);
            if (localMapData.isEmpty) {
                return [];
            }

            const patchComputerGpu = await this.getPatchComputerGpu();
            const buffer = await patchComputerGpu.computeBuffer(localMapData);
            return this.assembleGeometryAndMaterials(buffer);
        });
    }
}

export { PatchFactoryGpuSequential };
