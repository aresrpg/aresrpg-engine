import { PackedUintFactory } from '../../../../../helpers/uint-packing';

class VertexData2Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelMaterialId = this.packedUintFactory.encodePart(1 << 15);
    public readonly faceNoiseId = this.packedUintFactory.encodePart(16);
    public readonly normalId = this.packedUintFactory.encodePart(6);
    public readonly uvRightId = this.packedUintFactory.encodePart(6);

    public encode(voxelMaterialId: number, faceNoiseId: number, normalId: number, uvRightId: number): number {
        return (
            this.voxelMaterialId.encode(voxelMaterialId) +
            this.faceNoiseId.encode(faceNoiseId) +
            this.normalId.encode(normalId) +
            this.uvRightId.encode(uvRightId)
        );
    }

    public wgslEncodeVoxelData(
        voxelMaterialIdVarname: string,
        faceNoiseIdVarname: string,
        normalIdVarname: string,
        uvRightIdVarname: string
    ): string {
        return `(${this.voxelMaterialId.wgslEncode(voxelMaterialIdVarname)} + ${this.faceNoiseId.wgslEncode(faceNoiseIdVarname)}
        + ${this.normalId.wgslEncode(normalIdVarname)} + ${this.uvRightId.wgslEncode(uvRightIdVarname)})`;
    }

    public serialize(): string {
        return `{
        voxelMaterialId: ${this.voxelMaterialId.serialize()},
        faceNoiseId: ${this.faceNoiseId.serialize()},
        normalId: ${this.normalId.serialize()},
        uvRightId: ${this.uvRightId.serialize()},
        ${this.encode.toString()},
    }`;
    }
}

export { VertexData2Encoder };
