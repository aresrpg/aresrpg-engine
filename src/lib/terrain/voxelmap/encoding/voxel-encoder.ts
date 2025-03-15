import { PackedUintFactory } from '../../../helpers/uint-packing';
import { EVoxelType } from '../i-voxelmap';

import { SolidVoxelEncoder } from './solid-voxel-encoder';

class VoxelEncoder {
    private readonly empty = 0;

    public readonly solidVoxel: SolidVoxelEncoder;

    public constructor() {
        const packedUintFactory = new PackedUintFactory(16);
        const emptiness = packedUintFactory.encodeNBits(1);
        packedUintFactory.encodeNBits(13); // padding, reserved for voxel-specific data
        const voxelType = packedUintFactory.encodeNBits(2);

        const voxelTypeMask = 0b1000000000000011;

        // solid voxels
        {
            const solidVoxelTypeMaskValue = emptiness.encode(1) | voxelType.encode(EVoxelType.SOLID);
            const packedUintFactory = new PackedUintFactory(16);
            packedUintFactory.encodeNBits(1); // reserved for emptiness
            this.solidVoxel = new SolidVoxelEncoder(packedUintFactory, voxelTypeMask, solidVoxelTypeMaskValue);
            if (packedUintFactory.getNextAvailableBit() > 14) {
                throw new Error('Last two bits are reserved for voxel type');
            }
            if (this.solidVoxel.isOfType(this.empty)) {
                throw new Error();
            }
        }
    }

    public encodeEmpty(): number {
        return this.empty;
    }

    public serialize(): string {
        return `{
            solidVoxel: ${this.solidVoxel.serialize()},
        }`;
    }
}

export { VoxelEncoder };
