import * as THREE from '../../../../../../three-usage';
import { voxelmapDataPacking, type IVoxelMaterial, type VoxelsChunkSize } from '../../../../i-voxelmap';
import * as Cube from '../../cube';
import { type GeometryAndMaterial, type VertexData, type VoxelsChunkData } from '../../voxels-renderable-factory-base';
import { VoxelsRenderableFactory } from '../voxels-renderable-factory';

type FaceData = {
    readonly voxelLocalPosition: THREE.Vector3Like;
    readonly voxelMaterialId: number;
    readonly voxelIsCheckerboard: boolean;
    readonly faceType: Cube.FaceType;
    readonly faceId: number;
    readonly verticesData: [VertexData, VertexData, VertexData, VertexData];
};

type VoxelsChunkCache = VoxelsChunkData & {
    neighbourExists(voxelIndex: number, neighbourRelativePosition: THREE.Vector3): boolean;
};

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly isCheckerboardMode?: boolean | undefined;
};

class VoxelsRenderableFactoryCpu extends VoxelsRenderableFactory {
    private readonly serializableFactory = {
        cube: {
            faces: Cube.faces,
            faceIndices: Cube.faceIndices,
        },

        vertexData1Encoder: this.vertexData1Encoder,
        vertexData2Encoder: VoxelsRenderableFactory.vertexData2Encoder,

        voxelmapDataPacking,

        isCheckerboard: false,

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

            const faceVerticesData = new Uint32Array(uint32PerVertex * 4);
            const voxelsChunkCache = this.buildLocalMapCache(voxelsChunkData);
            for (const faceData of this.iterateOnVisibleFacesWithCache(voxelsChunkCache)) {
                let faceNoiseId: number;

                if (this.isCheckerboard || faceData.voxelIsCheckerboard) {
                    faceNoiseId = (faceData.voxelLocalPosition.x + faceData.voxelLocalPosition.y + faceData.voxelLocalPosition.z) % 2;
                } else {
                    faceNoiseId = 2 + Math.floor(Math.random() * (this.vertexData2Encoder.faceNoiseId.maxValue - 2));
                }

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
                return !this.voxelmapDataPacking.isEmpty(neighbourData);
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

                        if (!this.voxelmapDataPacking.isEmpty(cacheData)) {
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
                                const voxelMaterialId = this.voxelmapDataPacking.getMaterialid(cacheData);
                                const voxelIsCheckerboard = this.voxelmapDataPacking.isCheckerboard(cacheData);

                                for (const face of Object.values(this.cube.faces)) {
                                    if (voxelsChunkCache.neighbourExists(cacheIndex, face.normal.vec)) {
                                        // this face will be hidden -> skip it
                                        continue;
                                    }

                                    yield {
                                        voxelLocalPosition,
                                        voxelMaterialId,
                                        voxelIsCheckerboard,
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

    public constructor(params: Parameters) {
        const noise = params.isCheckerboardMode
            ? {
                  resolution: 1,
                  textureBuilder: () => new THREE.DataTexture(new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]), 2, 1),
              }
            : undefined;

        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: params.maxVoxelsChunkSize,
            noise,
        });

        this.serializableFactory.isCheckerboard = !!params.isCheckerboardMode;
    }

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
    voxelmapDataPacking: ${this.serializableFactory.voxelmapDataPacking.serialize()},
    isCheckerboard: ${this.serializableFactory.isCheckerboard},
    ${this.serializableFactory.buildBuffer},
    ${this.serializableFactory.buildLocalMapCache},
    ${this.serializableFactory.iterateOnVisibleFacesWithCache},
}`;
    }
}

export { VoxelsRenderableFactoryCpu };
