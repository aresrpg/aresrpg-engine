import { PackedUintFactory } from '../../../helpers/uint-packing';

class VoxelEncoder {
    private readonly packedUintFactory = new PackedUintFactory(16);
    private readonly isNotEmpty = this.packedUintFactory.encodeNValues(1 << 2);
    private readonly isChecker = this.packedUintFactory.encodeNValues(1 << 2);
    private readonly materialId = this.packedUintFactory.encodeNValues(1 << 12);

    private readonly empty: number;

    public constructor() {
        if (!this.isEmpty(0)) {
            throw new Error(`0 should always mean the voxel is empty.`);
        }

        this.empty = this.encodeInternal(true, false, 0);
    }

    public encodeEmpty(): number {
        return this.empty;
    }

    public encode(isCheckerboard: boolean, materialId: number): number {
        return this.encodeInternal(false, isCheckerboard, materialId);
    }

    private encodeInternal(isEmpty: boolean, isCheckerboard: boolean, materialId: number): number {
        return this.isNotEmpty.encode(+!isEmpty) + this.isChecker.encode(+isCheckerboard) + this.materialId.encode(materialId);
    }

    public isEmpty(data: number): boolean {
        return this.isNotEmpty.decode(data) === 0;
    }

    public wgslIsEmpty(varname: string): string {
        return `(${this.isNotEmpty.wgslDecode(varname)} == 0u)`;
    }

    public isCheckerboard(data: number): boolean {
        return this.isChecker.decode(data) === 1;
    }

    public wgslIsCheckerboard(varname: string): string {
        return `(${this.isChecker.wgslDecode(varname)} == 1u)`;
    }

    public getMaterialId(data: number): number {
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
            isChecker: ${this.isChecker.serialize()},
            empty: ${this.empty},
            ${this.encodeEmpty.toString()},
            ${this.encode.toString()},
            ${this.encodeInternal.toString()},
            ${this.isEmpty.toString()},
            ${this.isCheckerboard.toString()},
            ${this.getMaterialId.toString()},
        }`;
    }
}

export { VoxelEncoder };
