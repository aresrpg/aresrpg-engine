import { type VoxelsChunkSize, type IVoxelMaterial } from '../../../../i-voxelmap';
import { type GeometryAndMaterial, type VoxelsChunkData } from '../../voxels-renderable-factory-base';
import { VoxelsRenderableFactory } from '../voxels-renderable-factory';

import { VoxelsComputerGpu } from './voxels-computer-gpu';

class VoxelsRenderableFactoryGpu extends VoxelsRenderableFactory {
    private readonly voxelsComputerGpuPromise: Promise<VoxelsComputerGpu> | null = null;

    public constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, voxelsChunkSize: VoxelsChunkSize) {
        super(voxelMaterialsList, voxelsChunkSize);
        const localCacheSize = this.maxVoxelsChunkSize.clone().addScalar(2);
        this.voxelsComputerGpuPromise = VoxelsComputerGpu.create(
            localCacheSize,
            this.vertexData1Encoder,
            VoxelsRenderableFactory.vertexData2Encoder
        );
    }

    protected override async disposeInternal(): Promise<void> {
        await super.disposeInternal();

        const computer = await this.voxelsComputerGpuPromise;
        if (computer) {
            computer.dispose();
        }
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

export { VoxelsRenderableFactoryGpu };
