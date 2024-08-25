import { PackedUintFactory } from '../../../../../helpers/uint-packing';

type CheckerboardCellId =
    | 0 // not a checkerboard cell
    | 1 // light checkerboard cell
    | 2; // dark checkerboard cell

class VertexData2Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelMaterialId = this.packedUintFactory.encodePart(1 << 15);
    public readonly checkerboardCellId = this.packedUintFactory.encodePart(3);
    public readonly normalId = this.packedUintFactory.encodePart(6);
    public readonly uvRightId = this.packedUintFactory.encodePart(6);

    public encode(voxelMaterialId: number, checkerboardCellId: CheckerboardCellId, normalId: number, uvRightId: number): number {
        return (
            this.voxelMaterialId.encode(voxelMaterialId) +
            this.checkerboardCellId.encode(checkerboardCellId) +
            this.normalId.encode(normalId) +
            this.uvRightId.encode(uvRightId)
        );
    }

    public wgslEncodeVoxelData(
        voxelMaterialIdVarname: string,
        checkerboardCellIdVarname: string,
        normalIdVarname: string,
        uvRightIdVarname: string
    ): string {
        return `(${this.voxelMaterialId.wgslEncode(voxelMaterialIdVarname)} + ${this.checkerboardCellId.wgslEncode(checkerboardCellIdVarname)}
        + ${this.normalId.wgslEncode(normalIdVarname)} + ${this.uvRightId.wgslEncode(uvRightIdVarname)})`;
    }

    public serialize(): string {
        return `{
        voxelMaterialId: ${this.voxelMaterialId.serialize()},
        checkerboardCellId: ${this.checkerboardCellId.serialize()},
        normalId: ${this.normalId.serialize()},
        uvRightId: ${this.uvRightId.serialize()},
        ${this.encode.toString()},
    }`;
    }
}

export { VertexData2Encoder, type CheckerboardCellId };
