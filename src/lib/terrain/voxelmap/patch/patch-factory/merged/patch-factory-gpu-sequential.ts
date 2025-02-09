import { type MaterialsStore } from '../../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { VoxelsRenderableFactoryGpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly patchSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class PatchFactoryGpuSequential extends PatchFactoryBase {
    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu({
            voxelMaterialsStore: params.voxelMaterialsStore,
            voxelsChunkSize: params.patchSize,
            checkerboardType: params.checkerboardType,
            voxelsChunkOrdering: params.voxelsChunkOrdering,
        });
        super(voxelsRenderableFactory);
    }
}

export { PatchFactoryGpuSequential };
