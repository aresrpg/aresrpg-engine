import type * as THREE from 'three-usage';

import { type VoxelsChunkSize } from '../../../i-voxelmap';
import { PackedUintFactory, type PackedUintFragment } from '../../../../../helpers/uint-packing';

class VertexData1Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly positionX: PackedUintFragment;
    public readonly positionY: PackedUintFragment;
    public readonly positionZ: PackedUintFragment;
    public readonly faceId: PackedUintFragment;
    public readonly ao: PackedUintFragment;
    public readonly edgeRoundness: PackedUintFragment;

    public constructor(maxVoxelsChunkSize: VoxelsChunkSize) {
        this.positionX = this.packedUintFactory.encodePart(maxVoxelsChunkSize.xz + 1);
        this.positionY = this.packedUintFactory.encodePart(maxVoxelsChunkSize.y + 1);
        this.positionZ = this.packedUintFactory.encodePart(maxVoxelsChunkSize.xz + 1);
        this.faceId = this.packedUintFactory.encodePart(6);
        this.ao = this.packedUintFactory.encodePart(4);
        this.edgeRoundness = this.packedUintFactory.encodePart(4);
    }

    public encode(position: THREE.Vector3Like, faceId: number, ao: number, edgeRoundness: [boolean, boolean]): number {
        return (
            this.positionX.encode(position.x) +
            this.positionY.encode(position.y) +
            this.positionZ.encode(position.z) +
            this.faceId.encode(faceId) +
            this.ao.encode(ao) +
            this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1))
        );
    }

    public wgslEncodeVertexData(positionVarname: string, aoVarname: string, edgeRoundessX: string, edgeRoundnessY: string): string {
        return `(${this.positionX.wgslEncode(positionVarname + '.x')} + ${this.positionY.wgslEncode(positionVarname + '.y')} + ${this.positionZ.wgslEncode(positionVarname + '.z')} +
            ${this.ao.wgslEncode(aoVarname)} + ${this.edgeRoundness.wgslEncode(`(${edgeRoundessX} + (${edgeRoundnessY} << 1u))`)})`;
    }

    public serialize(): string {
        return `{
        positionX: ${this.positionX.serialize()},
        positionY: ${this.positionY.serialize()},
        positionZ: ${this.positionZ.serialize()},
        faceId: ${this.faceId.serialize()},
        ao: ${this.ao.serialize()},
        edgeRoundness: ${this.edgeRoundness.serialize()},
        ${this.encode.toString()},
    }`;
    }
}

export { VertexData1Encoder };
