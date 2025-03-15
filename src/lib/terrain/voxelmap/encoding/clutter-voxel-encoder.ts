import { type PackedUintFactory, type PackedUintFragment } from '../../../helpers/uint-packing';

import { SpecializedVoxelEncoder } from './specialized-voxel-encoder';

class ClutterVoxelEncoder extends SpecializedVoxelEncoder {
    private readonly clutterId: PackedUintFragment;
    private readonly count: PackedUintFragment;

    public constructor(packedUintFactory: PackedUintFactory, voxelTypeMask: number, voxelTypeMaskValue: number) {
        super(voxelTypeMask, voxelTypeMaskValue);

        this.clutterId = packedUintFactory.encodeNBits(10);
        this.count = packedUintFactory.encodeNBits(2);
    }

    public encode(clutterId: number, count: number): number {
        return this.voxelTypeMaskValue | this.clutterId.encode(clutterId) | this.count.encode(count);
    }

    public getClutterId(data: number): boolean {
        return this.clutterId.decode(data) === 1;
    }

    public getCount(data: number): number {
        return this.count.decode(data);
    }

    public serialize(): string {
        return `{
            clutterId: ${this.clutterId.serialize()},
            count: ${this.count.serialize()},

            voxelTypeMask: ${this.voxelTypeMask},
            voxelTypeMaskValue: ${this.voxelTypeMaskValue},

            ${this.encode.toString()},

            ${this.isOfType.toString()},
            ${this.getClutterId.toString()},
            ${this.getCount.toString()},
        }`;
    }
}

export { ClutterVoxelEncoder };
