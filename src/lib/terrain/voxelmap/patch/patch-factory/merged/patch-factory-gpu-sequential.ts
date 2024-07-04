import { PromiseThrottler } from '../../../../../helpers/promise-throttler';
import * as THREE from '../../../../../three-usage';
import { type VoxelsChunkSize } from '../../../../terrain';
import { type IVoxelMap, type IVoxelMaterial } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryGpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { PatchFactoryBase } from '../patch-factory-base';

class PatchFactoryGpuSequential extends PatchFactoryBase {
    private readonly throttler = new PromiseThrottler(1);

    public constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu(voxelMaterialsList, patchSize);
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