import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode, type GeometryAndMaterial } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';
import * as THREE from '../../../../../three-usage';

import { PatchComputerGpu } from './patch-computer-gpu';

class PatchFactoryGpuSequential extends PatchFactory {
    private readonly patchComputerGpuPromise: Promise<PatchComputerGpu> | null = null;

    private readonly gpuSequentialLimiter = new PromiseThrottler(1);

    public constructor(map: IVoxelMap) {
        super(map, EPatchComputingMode.GPU_SEQUENTIAL);
        const localCacheSize = this.maxPatchSize.clone().addScalar(2);
        this.patchComputerGpuPromise = PatchComputerGpu.create(localCacheSize, PatchFactory.vertexDataEncoder);
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

    protected override async disposeInternal(): Promise<void> {
        await super.disposeInternal();

        const computer = await this.patchComputerGpuPromise;
        if (computer) {
            computer.dispose();
        }
    }
}

export { PatchFactoryGpuSequential };
