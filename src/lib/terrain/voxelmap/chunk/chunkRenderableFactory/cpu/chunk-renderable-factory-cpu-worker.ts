import { type MaterialsStore } from '../../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { VoxelsRenderableFactoryCpuWorker } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { ChunkRenderableFactoryBase } from '../chunk-renderable-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly workersPoolSize: number;
    readonly checkerboardType?: CheckerboardType;
    readonly greedyMeshing?: boolean;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class ChunkRenderableFactoryCpuWorker extends ChunkRenderableFactoryBase {
    public override readonly maxChunksComputedInParallel: number;

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpuWorker(params);
        super(voxelsRenderableFactory);

        this.maxChunksComputedInParallel = params.workersPoolSize;
    }
}

export { ChunkRenderableFactoryCpuWorker };
