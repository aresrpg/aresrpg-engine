import { type MaterialsStore } from '../../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { VoxelsRenderableFactoryCpuWorker } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly patchSize: VoxelsChunkSize;
    readonly workersPoolSize: number;
    readonly checkerboardType?: CheckerboardType;
    readonly greedyMeshing?: boolean;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class PatchFactoryCpuWorker extends PatchFactoryBase {
    public override readonly maxPatchesComputedInParallel: number;

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpuWorker({
            voxelMaterialsStore: params.voxelMaterialsStore,
            maxVoxelsChunkSize: params.patchSize,
            workersPoolSize: params.workersPoolSize,
            checkerboardType: params.checkerboardType,
            greedyMeshing: params.greedyMeshing,
            voxelsChunkOrdering: params.voxelsChunkOrdering,
        });
        super(voxelsRenderableFactory);

        this.maxPatchesComputedInParallel = params.workersPoolSize;
    }
}

export { PatchFactoryCpuWorker };
