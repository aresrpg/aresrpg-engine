import { type MaterialsStore } from '../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../i-voxelmap';
import { VoxelsRenderableFactoryCpu } from '../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu';
import { type CheckerboardType } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { ChunkRenderableFactoryBase } from './chunk-renderable-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType;
    readonly greedyMeshing?: boolean;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class ChunkRenderableFactoryCpu extends ChunkRenderableFactoryBase {
    public override readonly maxChunksComputedInParallel = 1;

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpu(params);
        super(voxelsRenderableFactory);
    }
}

export { ChunkRenderableFactoryCpu };
