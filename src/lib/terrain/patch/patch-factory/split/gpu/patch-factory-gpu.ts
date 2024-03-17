import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';

import { PatchComputerGpu } from './patch-computer-gpu';

abstract class PatchFactoryGpu extends PatchFactory {
    protected readonly patchComputerGpuPromise: Promise<PatchComputerGpu> | null = null;

    protected constructor(map: IVoxelMap, computingMode: EPatchComputingMode) {
        if (computingMode !== EPatchComputingMode.GPU_SEQUENTIAL) {
            throw new Error(`Unsupported computing mode "${computingMode}".`);
        }
        super(map, computingMode);
        const localCacheSize = this.maxPatchSize.clone().addScalar(2);
        this.patchComputerGpuPromise = PatchComputerGpu.create(localCacheSize, PatchFactory.vertexDataEncoder);
    }

    protected override async disposeInternal(): Promise<void> {
        await super.disposeInternal();

        const computer = await this.patchComputerGpuPromise;
        if (computer) {
            computer.dispose();
        }
    }
}

export { PatchFactoryGpu };
