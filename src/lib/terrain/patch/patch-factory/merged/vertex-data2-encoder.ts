import { PackedUintFactory } from '../uint-packing';

class VertexData2Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelMaterialId = this.packedUintFactory.encodePart(1 << 15);

    public encode(
        voxelMaterialId: number,
    ): number {
        return (
            this.voxelMaterialId.encode(voxelMaterialId)
        );
    }

    public wgslEncodeVoxelData(voxelMaterialIdVarname: string): string {
        return `(${this.voxelMaterialId.wgslEncode(voxelMaterialIdVarname)})`;
    }
}

export { VertexData2Encoder };
