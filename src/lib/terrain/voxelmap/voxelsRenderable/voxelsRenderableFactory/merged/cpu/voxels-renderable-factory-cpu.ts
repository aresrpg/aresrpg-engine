import type * as THREE from '../../../../../../three-usage';
import * as Cube from '../../cube';
import { type GeometryAndMaterial, type VertexData, type VoxelsChunkData } from '../../voxels-renderable-factory-base';
import { VoxelsRenderableFactory } from '../voxels-renderable-factory';

type FaceData = {
    readonly voxelLocalPosition: THREE.Vector3Like;
    readonly voxelMaterialId: number;
    readonly faceType: Cube.FaceType;
    readonly faceId: number;
    readonly verticesData: [VertexData, VertexData, VertexData, VertexData];
};

type VoxelsChunkCache = VoxelsChunkData & {
    neighbourExists(voxelIndex: number, neighbourRelativePosition: THREE.Vector3): boolean;
};

class VoxelsRenderableFactoryCpu extends VoxelsRenderableFactory {
    private readonly serializableFactory = {
        cube: {
            faces: Cube.faces,
            faceIndices: Cube.faceIndices,
        },

        vertexData1Encoder: this.vertexData1Encoder,
        vertexData2Encoder: VoxelsRenderableFactory.vertexData2Encoder,

        buildBuffer(voxelsChunkData: VoxelsChunkData): Uint32Array {
            const innerChunkSize = {
                x: voxelsChunkData.size.x - 2,
                y: voxelsChunkData.size.y - 2,
                z: voxelsChunkData.size.z - 2,
            };
            const maxVoxelsCount = innerChunkSize.x * innerChunkSize.y * innerChunkSize.z;

            const maxFacesPerVoxel = 6;
            const verticesPerFace = 6;
            const uint32PerVertex = 2;
            const bufferLength = maxFacesPerVoxel * maxVoxelsCount * verticesPerFace * uint32PerVertex;

            const bufferData = {
                buffer: new Uint32Array(bufferLength),
                verticesCount: 0,
            };

            let faceId = 0;
            const faceVerticesData = new Uint32Array(uint32PerVertex * 4);
            const voxelsChunkCache = this.buildLocalMapCache(voxelsChunkData);
            for (const faceData of this.iterateOnVisibleFacesWithCache(voxelsChunkCache)) {
                const faceNoiseId = faceId++ % this.vertexData2Encoder.faceNoiseId.maxValue;

                faceData.verticesData.forEach((faceVertexData: VertexData, faceVertexIndex: number) => {
                    faceVerticesData[2 * faceVertexIndex + 0] = this.vertexData1Encoder.encode(
                        faceData.voxelLocalPosition,
                        faceVertexData.localPosition,
                        faceData.faceId,
                        faceVertexData.ao,
                        [faceVertexData.roundnessX, faceVertexData.roundnessY]
                    );
                    faceVerticesData[2 * faceVertexIndex + 1] = this.vertexData2Encoder.encode(
                        faceData.voxelMaterialId,
                        faceNoiseId,
                        this.cube.faces[faceData.faceType].normal.id,
                        this.cube.faces[faceData.faceType].uvRight.id
                    );
                });

                for (const index of this.cube.faceIndices) {
                    const vertexIndex = uint32PerVertex * bufferData.verticesCount++;
                    bufferData.buffer[vertexIndex] = faceVerticesData[2 * index + 0]!;
                    bufferData.buffer[vertexIndex + 1] = faceVerticesData[2 * index + 1]!;
                }
            }

            return new Uint32Array(bufferData.buffer.subarray(0, uint32PerVertex * bufferData.verticesCount));
        },

        buildLocalMapCache(voxelsChunkData: VoxelsChunkData): VoxelsChunkCache {
            const indexFactor = { x: 1, y: voxelsChunkData.size.x, z: voxelsChunkData.size.x * voxelsChunkData.size.y };

            const buildIndexUnsafe = (position: THREE.Vector3Like) => {
                return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
            };

            const neighbourExists = (index: number, neighbour: THREE.Vector3Like) => {
                const deltaIndex = buildIndexUnsafe(neighbour);
                const neighbourIndex = index + deltaIndex;
                const neighbourData = voxelsChunkData.data[neighbourIndex];
                if (typeof neighbourData === 'undefined') {
                    throw new Error();
                }
                return neighbourData !== 0;
            };

            return Object.assign(voxelsChunkData, {
                neighbourExists,
            });
        },

        *iterateOnVisibleFacesWithCache(voxelsChunkCache: VoxelsChunkCache): Generator<FaceData> {
            if (voxelsChunkCache.isEmpty) {
                return;
            }

            let cacheIndex = 0;
            const localPosition = { x: 0, y: 0, z: 0 };
            for (localPosition.z = 0; localPosition.z < voxelsChunkCache.size.z; localPosition.z++) {
                for (localPosition.y = 0; localPosition.y < voxelsChunkCache.size.y; localPosition.y++) {
                    for (localPosition.x = 0; localPosition.x < voxelsChunkCache.size.x; localPosition.x++) {
                        const cacheData = voxelsChunkCache.data[cacheIndex];
                        if (typeof cacheData === 'undefined') {
                            throw new Error();
                        }

                        if (cacheData > 0) {
                            // if there is a voxel there
                            if (
                                localPosition.x > 0 &&
                                localPosition.y > 0 &&
                                localPosition.z > 0 &&
                                localPosition.x < voxelsChunkCache.size.x - 1 &&
                                localPosition.y < voxelsChunkCache.size.y - 1 &&
                                localPosition.z < voxelsChunkCache.size.z - 1
                            ) {
                                const voxelLocalPosition = { x: localPosition.x - 1, y: localPosition.y - 1, z: localPosition.z - 1 };
                                const voxelMaterialId = cacheData - 1;

                                for (const face of Object.values(this.cube.faces)) {
                                    if (voxelsChunkCache.neighbourExists(cacheIndex, face.normal.vec)) {
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
                                                voxelsChunkCache.neighbourExists(cacheIndex, neighbourVoxel)
                                            ) as [boolean, boolean, boolean];
                                            if (a && b) {
                                                ao = 3;
                                            } else {
                                                ao = +a + +b + +c;
                                            }

                                            let roundnessX = true;
                                            let roundnessY = true;
                                            for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.x) {
                                                roundnessX &&= !voxelsChunkCache.neighbourExists(cacheIndex, neighbourVoxel);
                                            }
                                            for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.y) {
                                                roundnessY &&= !voxelsChunkCache.neighbourExists(cacheIndex, neighbourVoxel);
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
        },
    };

    public async buildGeometryAndMaterials(voxelsChunkData: VoxelsChunkData): Promise<GeometryAndMaterial[]> {
        if (voxelsChunkData.isEmpty) {
            return [];
        }
        const buffer = await this.buildBuffer(voxelsChunkData);
        return this.assembleGeometryAndMaterials(buffer);
    }

    protected async buildBuffer(voxelsChunkData: VoxelsChunkData): Promise<Uint32Array> {
        return this.serializableFactory.buildBuffer(voxelsChunkData);
    }

    protected serialize(): string {
        return `{
    cube: ${JSON.stringify(this.serializableFactory.cube)},
    vertexData1Encoder: ${this.serializableFactory.vertexData1Encoder.serialize()},
    vertexData2Encoder: ${this.serializableFactory.vertexData2Encoder.serialize()},
    ${this.serializableFactory.buildBuffer},
    ${this.serializableFactory.buildLocalMapCache},
    ${this.serializableFactory.iterateOnVisibleFacesWithCache},
}`;
    }
}

export { VoxelsRenderableFactoryCpu };
