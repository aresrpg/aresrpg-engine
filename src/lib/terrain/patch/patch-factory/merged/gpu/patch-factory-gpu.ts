import { type IVoxelMap } from '../../../../i-voxel-map';
import { PatchFactory } from '../patch-factory';
import { type PatchSize } from '../vertex-data1-encoder';

import { PatchComputerGpu } from './patch-computer-gpu';

abstract class PatchFactoryGpu extends PatchFactory {
    private readonly patchComputerGpuPromise: Promise<PatchComputerGpu> | null = null;

    public constructor(map: IVoxelMap, patchSize: PatchSize) {
        super(map, patchSize);
        const localCacheSize = this.maxPatchSize.clone().addScalar(2);
        this.patchComputerGpuPromise = PatchComputerGpu.create(localCacheSize, this.vertexData1Encoder, PatchFactory.vertexData2Encoder);
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
