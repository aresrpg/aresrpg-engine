import { PackedUintFactory } from '../../helpers/uint-packing';

class VoxelmapDataPacking {
    private readonly packedUintFactory = new PackedUintFactory(16);
    private readonly isNotEmpty = this.packedUintFactory.encodePart(1 << 2);
    private readonly materialId = this.packedUintFactory.encodePart(1 << 12);

    public constructor() {
        if (!this.isEmpty(0)) {
            throw new Error(`0 should always mean the voxel is empty.`);
        }
    }

    public encode(isEmpty: boolean, materialId: number): number {
        return this.isNotEmpty.encode(+!isEmpty) + this.materialId.encode(materialId);
    }

    public isEmpty(data: number): boolean {
        return this.isNotEmpty.decode(data) === 0;
    }

    public wgslIsEmpty(varname: string): string {
        return `(${this.isNotEmpty.wgslDecode(varname)} == 0u)`;
    }

    public getMaterialid(data: number): number {
        if (this.isEmpty(data)) {
            throw new Error(`Cannot extract material ID from empty data.`);
        }
        return this.materialId.decode(data);
    }

    public wgslGetMaterialId(varname: string): string {
        return this.materialId.wgslDecode(varname);
    }

    public serialize(): string {
        return `{
            isNotEmpty: ${this.isNotEmpty.serialize()},
            materialId: ${this.materialId.serialize()},
            ${this.encode.toString()},
            ${this.isEmpty.toString()},
            ${this.getMaterialid.toString()},
        }`;
    }
}

export { VoxelmapDataPacking };
