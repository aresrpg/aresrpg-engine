import { PackedUintFactory } from "../uint-packing";

class VertexDataEncoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelX = this.packedUintFactory.encodePart(128);
    public readonly voxelY = this.packedUintFactory.encodePart(64);
    public readonly voxelZ = this.packedUintFactory.encodePart(128);
    public readonly ao = this.packedUintFactory.encodePart(4);
    public readonly edgeRoundness = this.packedUintFactory.encodePart(4);
    public readonly voxelType = this.packedUintFactory.encodePart(1 << (32 - this.packedUintFactory.getNextAvailableBit()));

    public encode(posX: number, posY: number, posZ: number, voxelType: number, ao: number, edgeRoundness: [boolean, boolean]): number {
        return this.voxelX.encode(posX) + this.voxelY.encode(posY) + this.voxelZ.encode(posZ)
            + this.voxelType.encode(voxelType)
            + this.ao.encode(ao)
            + this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1));
    }
}

export {
    VertexDataEncoder
};

