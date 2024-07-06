import type * as THREE from '../../../../../three-usage';
import { type VoxelsChunkSize } from '../../../i-voxelmap';
import { PackedUintFactory, type PackedUintFragment } from '../uint-packing';

class VertexData1Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelX: PackedUintFragment;
    public readonly voxelY: PackedUintFragment;
    public readonly voxelZ: PackedUintFragment;
    public readonly localX: PackedUintFragment;
    public readonly localY: PackedUintFragment;
    public readonly localZ: PackedUintFragment;
    public readonly faceId: PackedUintFragment;
    public readonly ao: PackedUintFragment;
    public readonly edgeRoundness: PackedUintFragment;

    public constructor(maxVoxelsChunkSize: VoxelsChunkSize) {
        this.voxelX = this.packedUintFactory.encodePart(maxVoxelsChunkSize.xz);
        this.voxelY = this.packedUintFactory.encodePart(maxVoxelsChunkSize.y);
        this.voxelZ = this.packedUintFactory.encodePart(maxVoxelsChunkSize.xz);
        this.localX = this.packedUintFactory.encodePart(2);
        this.localY = this.packedUintFactory.encodePart(2);
        this.localZ = this.packedUintFactory.encodePart(2);
        this.faceId = this.packedUintFactory.encodePart(6);
        this.ao = this.packedUintFactory.encodePart(4);
        this.edgeRoundness = this.packedUintFactory.encodePart(4);
    }

    public encode(
        voxelPos: THREE.Vector3Like,
        localPos: THREE.Vector3Like,
        faceId: number,
        ao: number,
        edgeRoundness: [boolean, boolean]
    ): number {
        return (
            this.voxelX.encode(voxelPos.x) +
            this.voxelY.encode(voxelPos.y) +
            this.voxelZ.encode(voxelPos.z) +
            this.localX.encode(localPos.x) +
            this.localY.encode(localPos.y) +
            this.localZ.encode(localPos.z) +
            this.faceId.encode(faceId) +
            this.ao.encode(ao) +
            this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1))
        );
    }

    public wgslEncodeVoxelData(voxelPosVarname: string): string {
        return `(${this.voxelX.wgslEncode(voxelPosVarname + '.x')} + ${this.voxelY.wgslEncode(voxelPosVarname + '.y')} + ${this.voxelZ.wgslEncode(voxelPosVarname + '.z')})`;
    }

    public wgslEncodeVertexData(localPosVarname: string, aoVarname: string, edgeRoundessX: string, edgeRoundnessY: string): string {
        return `(${this.localX.wgslEncode(localPosVarname + '.x')} + ${this.localY.wgslEncode(localPosVarname + '.y')} + ${this.localZ.wgslEncode(localPosVarname + '.z')} +
            ${this.ao.wgslEncode(aoVarname)} + ${this.edgeRoundness.wgslEncode(`(${edgeRoundessX} + (${edgeRoundnessY} << 1u))`)})`;
    }

    public serialize(): string {
        return `{
        voxelX: ${this.voxelX.serialize()},
        voxelY: ${this.voxelY.serialize()},
        voxelZ: ${this.voxelZ.serialize()},
        localX: ${this.localX.serialize()},
        localY: ${this.localY.serialize()},
        localZ: ${this.localZ.serialize()},
        faceId: ${this.faceId.serialize()},
        ao: ${this.ao.serialize()},
        edgeRoundness: ${this.edgeRoundness.serialize()},
        ${this.encode.toString()},
    }`;
    }
}

export { VertexData1Encoder };
