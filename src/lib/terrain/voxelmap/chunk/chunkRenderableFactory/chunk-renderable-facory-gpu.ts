import { type MaterialsStore } from '../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../i-voxelmap';
import { VoxelsRenderableFactoryGpu } from '../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { type CheckerboardType } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { ChunkRenderableFactoryBase } from './chunk-renderable-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly voxelsChunkSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class ChunkRenderableFactoryGpu extends ChunkRenderableFactoryBase {
    public override readonly maxChunksComputedInParallel = 1;

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu(params);
        super(voxelsRenderableFactory);
    }
}

export { ChunkRenderableFactoryGpu };
