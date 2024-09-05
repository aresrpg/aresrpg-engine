import type * as THREE from 'three-usage';

import { PromisesQueue } from '../../../../../helpers/async/promises-queue';
import { type IVoxelMap, type IVoxelMaterial, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpuWorker } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { type CheckerboardType } from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly patchSize: VoxelsChunkSize;
    readonly workersPoolSize: number;
    readonly checkerboardType?: CheckerboardType;
    readonly greedyMeshing?: boolean;
};

class PatchFactoryCpuWorker extends PatchFactoryBase {
    public readonly maxPatchesComputedInParallel: number;
    private readonly throttler: PromisesQueue;

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpuWorker({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: params.patchSize,
            workersPoolSize: params.workersPoolSize,
            checkerboardType: params.checkerboardType,
            greedyMeshing: params.greedyMeshing,
        });
        super(voxelsRenderableFactory);

        this.throttler = new PromisesQueue(voxelsRenderableFactory.workersPoolSize);
        this.maxPatchesComputedInParallel = params.workersPoolSize;
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
