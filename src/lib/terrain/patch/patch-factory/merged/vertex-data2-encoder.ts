import { PackedUintFactory } from '../uint-packing';

class VertexData2Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelMaterialId = this.packedUintFactory.encodePart(1 << 15);
    public readonly faceNoiseId = this.packedUintFactory.encodePart(16);

    public encode(
        voxelMaterialId: number,
        faceNoiseId: number,
    ): number {
        return (
            this.voxelMaterialId.encode(voxelMaterialId) +
            this.faceNoiseId.encode(faceNoiseId)
        );
    }

    public wgslEncodeVoxelData(voxelMaterialIdVarname: string, faceNoiseIdVarname: string): string {
        return `(${this.voxelMaterialId.wgslEncode(voxelMaterialIdVarname)} + ${this.faceNoiseId.wgslEncode(faceNoiseIdVarname)})`;
    }
}

export { VertexData2Encoder };
