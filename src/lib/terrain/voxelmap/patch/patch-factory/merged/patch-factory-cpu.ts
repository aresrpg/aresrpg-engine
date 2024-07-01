import * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type VoxelsChunkSize } from '../../../../terrain';
import { VoxelsRenderableFactoryCpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu';
import { PatchFactoryBase, type GeometryAndMaterial } from '../patch-factory-base';

class PatchFactoryCpu extends PatchFactoryBase {
    public constructor(map: IVoxelMap, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryCpu(map.voxelMaterialsList, patchSize);
        super(map, voxelsRenderableFactory);
    }

    protected async buildGeometryAndMaterials(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const localMapData = await this.buildLocalMapData(patchStart, patchEnd);
        return this.voxelsRenderableFactory.buildGeometryAndMaterials(localMapData);
    }
}

export { PatchFactoryCpu };
