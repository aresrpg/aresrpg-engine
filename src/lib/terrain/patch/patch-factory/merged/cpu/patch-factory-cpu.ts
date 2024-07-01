import * as THREE from '../../../../../three-usage';
import * as Cube from '../../cube';
import { type GeometryAndMaterial, type LocalMapData, type VertexData } from '../../patch-factory-base';
import { PatchFactory } from '../patch-factory';

type FaceData = {
    readonly voxelLocalPosition: THREE.Vector3;
    readonly voxelMaterialId: number;
    readonly faceType: Cube.FaceType;
    readonly faceId: number;
    readonly verticesData: [VertexData, VertexData, VertexData, VertexData];
};

type LocalMapCache = LocalMapData & {
    neighbourExists(voxelIndex: number, neighbourRelativePosition: THREE.Vector3): boolean;
};

class PatchFactoryCpu extends PatchFactory {
    protected async buildGeometryAndMaterials(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
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

    private async buildLocalMapCache(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<LocalMapCache> {
        const localMapData = await this.buildLocalMapData(patchStart, patchEnd);

        const indexFactor = { x: 1, y: localMapData.size.x, z: localMapData.size.x * localMapData.size.y };

        const buildIndexUnsafe = (position: THREE.Vector3) => {
            return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
        };

        const neighbourExists = (index: number, neighbour: THREE.Vector3) => {
            const deltaIndex = buildIndexUnsafe(neighbour);
            const neighbourIndex = index + deltaIndex;
            const neighbourData = localMapData.data[neighbourIndex];
            if (typeof neighbourData === 'undefined') {
                throw new Error();
            }
            return neighbourData !== 0;
        };

        return Object.assign(localMapData, {
            neighbourExists,
        });
    }

    private async iterateOnVisibleFaces(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<() => Generator<FaceData>> {
        const that = this;

        const localMapCache = await this.buildLocalMapCache(patchStart, patchEnd);
        return function* () {
            for (const a of that.iterateOnVisibleFacesWithCache(localMapCache)) {
                yield a;
            }
        };
    }

    private *iterateOnVisibleFacesWithCache(localMapCache: LocalMapCache): Generator<FaceData> {
        if (localMapCache.isEmpty) {
            return;
        }

        let cacheIndex = 0;
        const localPosition = new THREE.Vector3();
        for (localPosition.z = 0; localPosition.z < localMapCache.size.z; localPosition.z++) {
            for (localPosition.y = 0; localPosition.y < localMapCache.size.y; localPosition.y++) {
                for (localPosition.x = 0; localPosition.x < localMapCache.size.x; localPosition.x++) {
                    const cacheData = localMapCache.data[cacheIndex];
                    if (typeof cacheData === 'undefined') {
                        throw new Error();
                    }

                    if (cacheData > 0) {
                        // if there is a voxel there
                        if (
                            localPosition.x > 0 &&
                            localPosition.y > 0 &&
                            localPosition.z > 0 &&
                            localPosition.x < localMapCache.size.x - 1 &&
                            localPosition.y < localMapCache.size.y - 1 &&
                            localPosition.z < localMapCache.size.z - 1
                        ) {
                            const voxelLocalPosition = localPosition.clone().subScalar(1);
                            const voxelMaterialId = cacheData - 1;

                            for (const face of Object.values(Cube.faces)) {
                                if (localMapCache.neighbourExists(cacheIndex, face.normal.vec)) {
                                    // this face will be hidden -> skip it
                                    continue;
                                }

                                yield {
                                    voxelLocalPosition,
                                    voxelMaterialId,
                                    faceType: face.type,
                                    faceId: face.id,
                                    verticesData: face.vertices.map((faceVertex: Cube.FaceVertex): VertexData => {
                                        let ao = 0;
                                        const [a, b, c] = faceVertex.shadowingNeighbourVoxels.map(neighbourVoxel =>
                                            localMapCache.neighbourExists(cacheIndex, neighbourVoxel)
                                        ) as [boolean, boolean, boolean];
                                        if (a && b) {
                                            ao = 3;
                                        } else {
                                            ao = +a + +b + +c;
                                        }

                                        let roundnessX = true;
                                        let roundnessY = true;
                                        for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.x) {
                                            roundnessX &&= !localMapCache.neighbourExists(cacheIndex, neighbourVoxel);
                                        }
                                        for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.y) {
                                            roundnessY &&= !localMapCache.neighbourExists(cacheIndex, neighbourVoxel);
                                        }

                                        return {
                                            localPosition: faceVertex.vertex,
                                            ao,
                                            roundnessX,
                                            roundnessY,
                                        };
                                    }) as [VertexData, VertexData, VertexData, VertexData],
                                };
                            }
                        }
                    }
                    cacheIndex++;
                }
            }
        }
    }
}

export { PatchFactoryCpu };
