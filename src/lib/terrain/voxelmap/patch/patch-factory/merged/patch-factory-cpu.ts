import { type MaterialsStore } from '../../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { VoxelsRenderableFactoryCpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly patchSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType;
    readonly greedyMeshing?: boolean;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class PatchFactoryCpu extends PatchFactoryBase {
    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpu({
            voxelMaterialsStore: params.voxelMaterialsStore,
            maxVoxelsChunkSize: params.patchSize,
            checkerboardType: params.checkerboardType,
            greedyMeshing: params.greedyMeshing,
            voxelsChunkOrdering: params.voxelsChunkOrdering,
        });
        super(voxelsRenderableFactory);
    }
}

export { PatchFactoryCpu };
