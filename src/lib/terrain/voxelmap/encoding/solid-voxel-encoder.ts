import { type PackedUintFactory, type PackedUintFragment } from '../../../helpers/uint-packing';

import { SpecializedVoxelEncoder } from './specialized-voxel-encoder';

class SolidVoxelEncoder extends SpecializedVoxelEncoder {
    private readonly isChecker: PackedUintFragment;
    private readonly materialId: PackedUintFragment;

    public constructor(packedUintFactory: PackedUintFactory, voxelTypeMask: number, voxelTypeMaskValue: number) {
        super(voxelTypeMask, voxelTypeMaskValue);

        this.isChecker = packedUintFactory.encodeNBits(1);
        this.materialId = packedUintFactory.encodeNBits(12);
    }

    public encode(isCheckerboard: boolean, materialId: number): number {
        return this.voxelTypeMaskValue | this.isChecker.encode(+isCheckerboard) | this.materialId.encode(materialId);
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

            ${this.isOfType.toString()},
            ${this.isCheckerboard.toString()},
            ${this.getMaterialId.toString()},
        }`;
    }
}

export { SolidVoxelEncoder };
