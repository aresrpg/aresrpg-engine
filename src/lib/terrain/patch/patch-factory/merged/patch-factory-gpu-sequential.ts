import { PromiseThrottler } from '../../../../helpers/promise-throttler';
import * as THREE from '../../../../three-usage';
import { type IVoxelMap, type VoxelsChunkSize } from '../../../terrain';
import { VoxelsRenderableFactoryGpu } from '../../../voxelmap/voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { PatchFactoryBase, type GeometryAndMaterial } from '../patch-factory-base';

class PatchFactoryGpuSequential extends PatchFactoryBase {
    private readonly gpuSequentialLimiter = new PromiseThrottler(1);

    public constructor(map: IVoxelMap, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu(map.voxelMaterialsList, patchSize);
        super(map, voxelsRenderableFactory);
    }

    protected buildGeometryAndMaterials(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        return this.gpuSequentialLimiter.run(async () => {
            const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
            const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
            if (voxelsCountPerPatch <= 0) {
                return [];
            }

            const localMapData = await this.buildLocalMapData(patchStart, patchEnd);
            return this.voxelsRenderableFactory.buildGeometryAndMaterials(localMapData);
        });
    }
}

export { PatchFactoryGpuSequential };
