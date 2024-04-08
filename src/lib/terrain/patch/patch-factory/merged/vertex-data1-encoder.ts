import { PackedUintFactory } from '../uint-packing';

class VertexData1Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelX = this.packedUintFactory.encodePart(64);
    public readonly voxelY = this.packedUintFactory.encodePart(64);
    public readonly voxelZ = this.packedUintFactory.encodePart(64);
    public readonly ao = this.packedUintFactory.encodePart(4);
    public readonly edgeRoundness = this.packedUintFactory.encodePart(4);

    public encode(
        posX: number,
        posY: number,
        posZ: number,
        ao: number,
        edgeRoundness: [boolean, boolean]
    ): number {
        return (
            this.voxelX.encode(posX) +
            this.voxelY.encode(posY) +
            this.voxelZ.encode(posZ) +
            this.ao.encode(ao) +
            this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1))
        );
    }

    public wgslEncodeVoxelData(posXVarname: string, posYVarname: string, posZVarname: string): string {
        return `(${this.voxelX.wgslEncode(posXVarname)} + ${this.voxelY.wgslEncode(posYVarname)} + ${this.voxelZ.wgslEncode(posZVarname)})`;
    }

    public wgslEncodeVertexData(aoVarname: string, edgeRoundessX: string, edgeRoundnessY: string): string {
        return `(${this.ao.wgslEncode(aoVarname)} + ${this.edgeRoundness.wgslEncode(`(${edgeRoundessX} + (${edgeRoundnessY} << 1u))`)})`;
    }
}

export { VertexData1Encoder };
