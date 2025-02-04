import { PromisesQueue } from '../../../../../helpers/async/promises-queue';
import type * as THREE from '../../../../../libs/three-usage';
import { type MaterialsStore } from '../../../../materials-store';
import { type IVoxelMap, type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
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
    private readonly throttler = new PromisesQueue(1);

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

    protected override queryMapAndBuildVoxelsRenderable(
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        map: IVoxelMap
    ): Promise<VoxelsRenderable | null> {
        return this.throttler.run(async () => {
            const localMapData = await PatchFactoryBase.buildLocalMapData(patchStart, patchEnd, map);
            return await this.voxelsRenderableFactory.buildVoxelsRenderable(localMapData);
        });
    }
}

export { PatchFactoryCpu };
