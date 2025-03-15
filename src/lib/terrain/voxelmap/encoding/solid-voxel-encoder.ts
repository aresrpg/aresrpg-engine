import { type PackedUintFactory, type PackedUintFragment } from '../../../helpers/uint-packing';

class SolidVoxelEncoder {
    private readonly isChecker: PackedUintFragment;
    private readonly materialId: PackedUintFragment;

    private readonly voxelTypeMask: number;
    private readonly voxelTypeMaskValue: number;

    public constructor(packedUintFactory: PackedUintFactory, voxelTypeMask: number, voxelTypeMaskValue: number) {
        this.isChecker = packedUintFactory.encodeNBits(1);
        this.materialId = packedUintFactory.encodeNBits(12);

        this.voxelTypeMask = voxelTypeMask;
        this.voxelTypeMaskValue = voxelTypeMaskValue;

        if ((this.voxelTypeMask | this.voxelTypeMaskValue) !== this.voxelTypeMask) {
            throw new Error();
        }
    }

    public encode(isCheckerboard: boolean, materialId: number): number {
        return this.voxelTypeMaskValue | this.isChecker.encode(+isCheckerboard) | this.materialId.encode(materialId);
    }

    public isSolidVoxel(data: number): boolean {
        return (data & this.voxelTypeMask) === this.voxelTypeMaskValue;
    }

    public wgslIsSolidVoxel(varname: string): string {
        return `((${varname} & ${this.voxelTypeMask}u) == ${this.voxelTypeMaskValue}u)`;
    }

    public isCheckerboard(data: number): boolean {
        return this.isChecker.decode(data) === 1;
    }

    public wgslIsCheckerboard(varname: string): string {
        return `(${this.isChecker.wgslDecode(varname)} == 1u)`;
    }

    public getMaterialId(data: number): number {
        return this.materialId.decode(data);
    }

    public wgslGetMaterialId(varname: string): string {
        return this.materialId.wgslDecode(varname);
    }

    public serialize(): string {
        return `{
            isChecker: ${this.isChecker.serialize()},
            materialId: ${this.materialId.serialize()},

            voxelTypeMask: ${this.voxelTypeMask},
            voxelTypeMaskValue: ${this.voxelTypeMaskValue},

            ${this.encode.toString()},

            ${this.isSolidVoxel.toString()},
            ${this.isCheckerboard.toString()},
            ${this.getMaterialId.toString()},
        }`;
    }
}

export { SolidVoxelEncoder };
