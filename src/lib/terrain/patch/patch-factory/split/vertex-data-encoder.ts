import { PackedUintFactory } from '../uint-packing';

class VertexDataEncoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelX = this.packedUintFactory.encodePart(64);
    public readonly voxelY = this.packedUintFactory.encodePart(64);
    public readonly voxelZ = this.packedUintFactory.encodePart(64);
    public readonly ao = this.packedUintFactory.encodePart(4);
    public readonly edgeRoundness = this.packedUintFactory.encodePart(4);
    public readonly voxelMaterialId = this.packedUintFactory.encodePart(1 << (32 - this.packedUintFactory.getNextAvailableBit()));

    public encode(
        posX: number,
        posY: number,
        posZ: number,
        voxelMaterialId: number,
        ao: number,
        edgeRoundness: [boolean, boolean]
    ): number {
        return (
            this.voxelX.encode(posX) +
            this.voxelY.encode(posY) +
            this.voxelZ.encode(posZ) +
            this.voxelMaterialId.encode(voxelMaterialId) +
            this.ao.encode(ao) +
            this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1))
        );
    }

    public wgslEncodeVoxelData(posXVarname: string, posYVarname: string, posZVarname: string, voxelMaterialIdVarname: string): string {
        return `(${this.voxelX.wgslEncode(posXVarname)} + ${this.voxelY.wgslEncode(posYVarname)} + ${this.voxelZ.wgslEncode(posZVarname)}
          + ${this.voxelMaterialId.wgslEncode(voxelMaterialIdVarname)})`;
    }

    public wgslEncodeVertexData(aoVarname: string, edgeRoundessX: string, edgeRoundnessY: string): string {
        return `(${this.ao.wgslEncode(aoVarname)} + ${this.edgeRoundness.wgslEncode(`(${edgeRoundessX} + (${edgeRoundnessY} << 1u))`)})`;
    }
}

export { VertexDataEncoder };
