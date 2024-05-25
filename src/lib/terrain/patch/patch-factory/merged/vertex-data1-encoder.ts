import { PackedUintFactory, type PackedUintFragment } from '../uint-packing';
import * as THREE from '../../../../three-usage';

type PatchSize = {
    xz: number;
    y: number;
};

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

    public constructor(patchSize: PatchSize) {
        this.voxelX = this.packedUintFactory.encodePart(patchSize.xz);
        this.voxelY = this.packedUintFactory.encodePart(patchSize.y);
        this.voxelZ = this.packedUintFactory.encodePart(patchSize.xz);
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
}

export { VertexData1Encoder, type PatchSize };
