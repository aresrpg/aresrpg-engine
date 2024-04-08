import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';

import { PatchComputerGpu } from './patch-computer-gpu';

abstract class PatchFactoryGpu extends PatchFactory {
    private readonly patchComputerGpuPromise: Promise<PatchComputerGpu> | null = null;

    protected constructor(map: IVoxelMap, computingMode: EPatchComputingMode) {
        if (computingMode !== EPatchComputingMode.GPU_SEQUENTIAL && computingMode !== EPatchComputingMode.GPU_OPTIMIZED) {
            throw new Error(`Unsupported computing mode "${computingMode}".`);
        }
        super(map, computingMode);
        const localCacheSize = this.maxPatchSize.clone().addScalar(2);
        this.patchComputerGpuPromise = PatchComputerGpu.create(localCacheSize, PatchFactory.vertexData1Encoder, PatchFactory.vertexData2Encoder);
    }

    protected override async disposeInternal(): Promise<void> {
        await super.disposeInternal();

        const computer = await this.patchComputerGpuPromise;
        if (computer) {
            computer.dispose();
        }
    }

    protected async getPatchComputerGpu(): Promise<PatchComputerGpu> {
        const patchComputerGpu = await this.patchComputerGpuPromise;
        if (!patchComputerGpu) {
            throw new Error('Could not get WebGPU patch computer');
        }
        return patchComputerGpu;
    }
}

export { PatchFactoryGpu };
