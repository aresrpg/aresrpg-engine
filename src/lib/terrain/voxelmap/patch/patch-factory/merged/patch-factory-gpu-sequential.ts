import { PromisesQueue } from '../../../../../helpers/async/promises-queue';
import * as THREE from '../../../../../libs/three-usage';
import { type MaterialsStore } from '../../../../materials-store';
import { type IVoxelMap, type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
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
    private readonly throttler = new PromisesQueue(1);

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu({
            voxelMaterialsStore: params.voxelMaterialsStore,
            voxelsChunkSize: params.patchSize,
            checkerboardType: params.checkerboardType,
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
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return null;
            }

            const localMapData = await PatchFactoryBase.buildLocalMapData(patchStart, patchEnd, map);
            return await this.voxelsRenderableFactory.buildVoxelsRenderable(localMapData);
        });
    }
}

export { PatchFactoryGpuSequential };
