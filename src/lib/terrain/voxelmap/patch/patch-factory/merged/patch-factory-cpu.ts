import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import type * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type VoxelsChunkSize } from '../../../../terrain';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu';
import { PatchFactoryBase } from '../patch-factory-base';

class PatchFactoryCpu extends PatchFactoryBase {
    private readonly throttler = new PromiseThrottler(1);

    public constructor(map: IVoxelMap, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpu(map.voxelMaterialsList, patchSize);
        super(map, voxelsRenderableFactory);
    }

    protected override queryMapAndBuildVoxelsRenderable(
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3
    ): Promise<VoxelsRenderable | null> {
        return this.throttler.run(async () => {
            const localMapData = await this.buildLocalMapData(patchStart, patchEnd);
            return await this.voxelsRenderableFactory.buildVoxelsRenderable(localMapData);
        });
    }
}

export { PatchFactoryCpu };
