import * as THREE from '../../../../../three-usage';
import { type IVoxelMap } from '../../../../i-voxel-map';
import * as Cube from '../../cube';
import { EPatchComputingMode, type GeometryAndMaterial, type VertexData } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';
import { type PatchSize } from '../vertex-data1-encoder';

class PatchFactoryCpu extends PatchFactory {
    public constructor(map: IVoxelMap, patchSize: PatchSize) {
        super(map, EPatchComputingMode.CPU_CACHED, patchSize);
    }

    protected async computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const iterator = await this.iterateOnVisibleFaces(patchStart, patchEnd);

        const patchSize = patchEnd.clone().sub(patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;

        const maxFacesPerVoxel = 6;
        const verticesPerFace = 6;
        const uint32PerVertex = 2;
        const bufferLength = maxFacesPerVoxel * voxelsCountPerPatch * verticesPerFace * uint32PerVertex;

        const bufferData = {
            buffer: new Uint32Array(bufferLength),
            verticesCount: 0,
        };

        let faceId = 0;
        const faceVerticesData = new Uint32Array(uint32PerVertex * 4);
        for (const faceData of iterator()) {
            const faceNoiseId = faceId++ % PatchFactory.vertexData2Encoder.faceNoiseId.maxValue;

            faceData.verticesData.forEach((faceVertexData: VertexData, faceVertexIndex: number) => {
                faceVerticesData[2 * faceVertexIndex + 0] = this.vertexData1Encoder.encode(
                    faceData.voxelLocalPosition,
                    faceVertexData.localPosition,
                    faceData.faceId,
                    faceVertexData.ao,
                    [faceVertexData.roundnessX, faceVertexData.roundnessY]
                );
                faceVerticesData[2 * faceVertexIndex + 1] = PatchFactory.vertexData2Encoder.encode(
                    faceData.voxelMaterialId,
                    faceNoiseId,
                    Cube.faces[faceData.faceType].normal.id,
                    Cube.faces[faceData.faceType].uvRight.id
                );
            });

            for (const index of Cube.faceIndices) {
                const vertexIndex = uint32PerVertex * bufferData.verticesCount++;
                bufferData.buffer[vertexIndex] = faceVerticesData[2 * index + 0]!;
                bufferData.buffer[vertexIndex + 1] = faceVerticesData[2 * index + 1]!;
            }
        }

        const buffer = new Uint32Array(bufferData.buffer.subarray(0, uint32PerVertex * bufferData.verticesCount));
        return this.assembleGeometryAndMaterials(buffer);
    }
}

export { PatchFactoryCpu };
