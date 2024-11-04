import { type IVoxelMaterial, type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../../i-voxelmap';
import { type VoxelsChunkDataNotEmpty, type CheckerboardType, type GeometryAndMaterial } from '../../voxels-renderable-factory-base';
import { VoxelsRenderableFactory } from '../voxels-renderable-factory';

import { VoxelsComputerGpu } from './voxels-computer-gpu';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly voxelsChunkSize: VoxelsChunkSize;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
    readonly checkerboardType?: CheckerboardType | undefined;
};

class VoxelsRenderableFactoryGpu extends VoxelsRenderableFactory {
    private readonly voxelsComputerGpuPromise: Promise<VoxelsComputerGpu> | null = null;

    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: params.voxelsChunkSize,
            checkerboardType: params.checkerboardType,
        });
        const localCacheSize = this.maxVoxelsChunkSize.clone().addScalar(2);
        this.voxelsComputerGpuPromise = VoxelsComputerGpu.create(
            localCacheSize,
            this.vertexData1Encoder,
            VoxelsRenderableFactory.vertexData2Encoder,
            this.checkerboardType,
            params.voxelsChunkOrdering
        );
    }

    public override dispose(): void {
        super.dispose();
        this.voxelsComputerGpuPromise?.then(computer => computer.dispose());
    }

    public async buildGeometryAndMaterials(voxelsChunkData: VoxelsChunkDataNotEmpty): Promise<GeometryAndMaterial[]> {
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
