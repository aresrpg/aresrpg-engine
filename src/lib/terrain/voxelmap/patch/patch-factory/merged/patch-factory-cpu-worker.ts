import { PromisesQueue } from '../../../../../helpers/async/promises-queue';
import type * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type IVoxelMaterial, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpuWorker } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { PatchFactoryBase } from '../patch-factory-base';

class PatchFactoryCpuWorker extends PatchFactoryBase {
    public readonly maxPatchesComputedInParallel: number;
    private readonly throttler: PromisesQueue;

    public constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, patchSize: VoxelsChunkSize, workersPoolSize: number) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpuWorker({
            voxelMaterialsList,
            maxVoxelsChunkSize: patchSize,
            workersPoolSize,
        });
        super(voxelsRenderableFactory);

        this.throttler = new PromisesQueue(voxelsRenderableFactory.workersPoolSize);
        this.maxPatchesComputedInParallel = workersPoolSize;
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

export { PatchFactoryCpuWorker };
