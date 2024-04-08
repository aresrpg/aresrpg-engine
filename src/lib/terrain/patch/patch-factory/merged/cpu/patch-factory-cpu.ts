import * as THREE from '../../../../../three-usage';
import { type IVoxelMap } from '../../../../i-voxel-map';
import * as Cube from '../../cube';
import { EPatchComputingMode, type GeometryAndMaterial, type VertexData } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';

class PatchFactoryCpu extends PatchFactory {
    public constructor(map: IVoxelMap) {
        super(map, EPatchComputingMode.CPU_CACHED);
    }

    protected async computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const iterator = await this.iterateOnVisibleFaces(patchStart, patchEnd);

        const patchSize = patchEnd.clone().sub(patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;

        type BufferData = {
            readonly buffer: Uint32Array;
            verticesCount: number;
        };

        const verticesPerFace = 6;
        const uint32PerVertex = 2;
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

        let faceId = 0;
        const faceVerticesData = new Uint32Array(uint32PerVertex * 4);
        for (const faceData of iterator()) {
            const faceNoiseId = (faceId++) % PatchFactory.vertexData2Encoder.faceNoiseId.maxValue;

            faceData.verticesData.forEach((faceVertexData: VertexData, faceVertexIndex: number) => {
                faceVerticesData[2 * faceVertexIndex + 0] = PatchFactory.vertexData1Encoder.encode(
                    faceData.voxelLocalPosition.x,
                    faceData.voxelLocalPosition.y,
                    faceData.voxelLocalPosition.z,
                    faceVertexData.ao,
                    [faceVertexData.roundnessX, faceVertexData.roundnessY]
                );
                faceVerticesData[2 * faceVertexIndex + 1] = PatchFactory.vertexData2Encoder.encode(
                    faceData.voxelMaterialId,
                    faceNoiseId,
                );
            });

            const faceBufferData = facesBufferData[faceData.faceType];
            for (const index of Cube.faceIndices) {
                const vertexIndex = uint32PerVertex * (faceBufferData.verticesCount++);
                faceBufferData.buffer[vertexIndex] = faceVerticesData[2 * index + 0]!;
                faceBufferData.buffer[vertexIndex + 1] = faceVerticesData[2 * index + 1]!;
            }
        }

        const truncateFaceBufferData = (bufferData: BufferData) => new Uint32Array(bufferData.buffer.subarray(0, uint32PerVertex * bufferData.verticesCount));

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
