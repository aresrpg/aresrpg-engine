import { PackedUintFactory } from '../uint-packing';
import * as THREE from "../../../../three-usage";

class VertexData1Encoder {
    private readonly packedUintFactory = new PackedUintFactory(32);
    public readonly voxelX = this.packedUintFactory.encodePart(64);
    public readonly voxelY = this.packedUintFactory.encodePart(64);
    public readonly voxelZ = this.packedUintFactory.encodePart(64);
    public readonly localX = this.packedUintFactory.encodePart(2);
    public readonly localY = this.packedUintFactory.encodePart(2);
    public readonly localZ = this.packedUintFactory.encodePart(2);
    public readonly ao = this.packedUintFactory.encodePart(4);
    public readonly edgeRoundness = this.packedUintFactory.encodePart(4);

    public encode(
        voxelPos: THREE.Vector3Like,
        localPos: THREE.Vector3Like,
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
            this.ao.encode(ao) +
            this.edgeRoundness.encode(+edgeRoundness[0] + (+edgeRoundness[1] << 1))
        );
    }

    public wgslEncodeVoxelData(voxelPosVarname: string): string {
        return `(${this.voxelX.wgslEncode(voxelPosVarname + ".x")} + ${this.voxelY.wgslEncode(voxelPosVarname + ".y")} + ${this.voxelZ.wgslEncode(voxelPosVarname + ".z")})`;
    }

    public wgslEncodeVertexData(localPosVarname: string, aoVarname: string, edgeRoundessX: string, edgeRoundnessY: string): string {
        return `(${this.localX.wgslEncode(localPosVarname + ".x")} + ${this.localY.wgslEncode(localPosVarname + ".y")} + ${this.localZ.wgslEncode(localPosVarname + ".z")} +
            ${this.ao.wgslEncode(aoVarname)} + ${this.edgeRoundness.wgslEncode(`(${edgeRoundessX} + (${edgeRoundnessY} << 1u))`)})`;
    }
}

export { VertexData1Encoder };
