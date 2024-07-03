import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type VoxelsChunkSize } from '../../../../terrain';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryGpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { PatchFactoryBase } from '../patch-factory-base';

class PatchFactoryGpuSequential extends PatchFactoryBase {
    private readonly throttler = new PromiseThrottler(1);

    public constructor(map: IVoxelMap, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu(map.voxelMaterialsList, patchSize);
        super(map, voxelsRenderableFactory);
    }

    protected override queryMapAndBuildVoxelsRenderable(
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3
    ): Promise<VoxelsRenderable | null> {
        return this.throttler.run(async () => {
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return null;
            }

            const localMapData = await this.buildLocalMapData(patchStart, patchEnd);
            return await this.voxelsRenderableFactory.buildVoxelsRenderable(localMapData);
        });
    }
}

export { PatchFactoryGpuSequential };
