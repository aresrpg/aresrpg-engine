import { type IVoxelMaterial, type VoxelsChunkSize } from '../../../../i-voxelmap';
import { type GeometryAndMaterial, type VoxelsChunkData } from '../../voxels-renderable-factory-base';
import { VoxelsRenderableFactory } from '../voxels-renderable-factory';

import { VoxelsComputerGpu } from './voxels-computer-gpu';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly voxelsChunkSize: VoxelsChunkSize;
};

class VoxelsRenderableFactoryGpu extends VoxelsRenderableFactory {
    private readonly voxelsComputerGpuPromise: Promise<VoxelsComputerGpu> | null = null;

    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: params.voxelsChunkSize,
        });
        const localCacheSize = this.maxVoxelsChunkSize.clone().addScalar(2);
        this.voxelsComputerGpuPromise = VoxelsComputerGpu.create(
            localCacheSize,
            this.vertexData1Encoder,
            VoxelsRenderableFactory.vertexData2Encoder
        );
    }

    public override dispose(): void {
        super.dispose();
        this.voxelsComputerGpuPromise?.then(computer => computer.dispose());
    }

    public async buildGeometryAndMaterials(voxelsChunkData: VoxelsChunkData): Promise<GeometryAndMaterial[]> {
        if (voxelsChunkData.isEmpty) {
            return [];
        }

        const voxelsComputerGpu = await this.getVoxelsComputerGpu();
        const buffer = await voxelsComputerGpu.computeBuffer(voxelsChunkData);
        return this.assembleGeometryAndMaterials(buffer);
    }

    private async getVoxelsComputerGpu(): Promise<VoxelsComputerGpu> {
        const voxelsComputerGpu = await this.voxelsComputerGpuPromise;
        if (!voxelsComputerGpu) {
            throw new Error('Could not get WebGPU voxels computer');
        }
        return voxelsComputerGpu;
    }
}

export { VoxelsRenderableFactoryGpu, type Parameters };
