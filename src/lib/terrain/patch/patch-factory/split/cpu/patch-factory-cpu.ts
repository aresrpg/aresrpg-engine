import { EPatchComputingMode, type GeometryAndMaterial, type VertexData } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';
import * as Cube from '../../cube';
import { IVoxelMap } from '../../../../i-voxel-map';

class PatchFactoryCpu extends PatchFactory {
    public constructor(map: IVoxelMap, computingMode: EPatchComputingMode) {
        if (computingMode !== EPatchComputingMode.CPU_CACHED && computingMode !== EPatchComputingMode.CPU_SIMPLE) {
            throw new Error();
        }
        super(map, computingMode);
    }

    protected async computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const voxelsCountPerPatch = this.map.getMaxVoxelsCount(patchStart, patchEnd);
        if (voxelsCountPerPatch <= 0) {
            return [];
        }

        type BufferData = {
            readonly buffer: Uint32Array;
            verticesCount: number;
        };

        const verticesPerFace = 6;
        const uint32PerVertex = 1;
        const bufferLength = voxelsCountPerPatch * verticesPerFace * uint32PerVertex;
        const buildFaceBufferData = () => {
            return {
                buffer: new Uint32Array(bufferLength),
                verticesCount: 0,
            };
        };
        const facesBufferData: Record<Cube.FaceType, BufferData> = {
            up: buildFaceBufferData(),
            down: buildFaceBufferData(),
            left: buildFaceBufferData(),
            right: buildFaceBufferData(),
            front: buildFaceBufferData(),
            back: buildFaceBufferData(),
        };

        const faceVerticesData = new Uint32Array(4 * uint32PerVertex);
        for (const faceData of this.iterateOnVisibleFaces(patchStart, patchEnd)) {
            faceData.verticesData.forEach((faceVertexData: VertexData, faceVertexIndex: number) => {
                faceVerticesData[faceVertexIndex] = PatchFactory.vertexDataEncoder.encode(
                    faceData.voxelLocalPosition.x,
                    faceData.voxelLocalPosition.y,
                    faceData.voxelLocalPosition.z,
                    faceData.voxelMaterialId,
                    faceVertexData.ao,
                    [faceVertexData.roundnessX, faceVertexData.roundnessY]
                );
            });

            const faceBufferData = facesBufferData[faceData.faceType];
            for (const index of Cube.faceIndices) {
                faceBufferData.buffer[faceBufferData.verticesCount++] = faceVerticesData[index]!;
            }
        }

        const truncateFaceBufferData = (bufferData: BufferData) => bufferData.buffer.subarray(0, bufferData.verticesCount);

        const buffers: Record<Cube.FaceType, Uint32Array> = {
            up: truncateFaceBufferData(facesBufferData.up),
            down: truncateFaceBufferData(facesBufferData.down),
            left: truncateFaceBufferData(facesBufferData.left),
            right: truncateFaceBufferData(facesBufferData.right),
            front: truncateFaceBufferData(facesBufferData.front),
            back: truncateFaceBufferData(facesBufferData.back),
        };

        return this.assembleGeometryAndMaterials(buffers);
    }
}

export { PatchFactoryCpu };
