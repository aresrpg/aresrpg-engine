import { PromisesQueue } from '../../../../../helpers/async/promises-queue';
import type * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type IVoxelMaterial, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

class PatchFactoryCpu extends PatchFactoryBase {
    private readonly throttler = new PromisesQueue(1);

    public constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, patchSize: VoxelsChunkSize, checkerboardType?: CheckerboardType) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpu({
            voxelMaterialsList,
            maxVoxelsChunkSize: patchSize,
            checkerboardType,
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
