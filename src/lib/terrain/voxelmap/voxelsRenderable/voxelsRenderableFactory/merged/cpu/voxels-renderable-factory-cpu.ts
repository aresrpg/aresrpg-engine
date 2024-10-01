import type * as THREE from '../../../../../../libs/three-usage';
import { voxelmapDataPacking, type IVoxelMaterial, type VoxelsChunkSize } from '../../../../i-voxelmap';
import * as Cube from '../../cube';
import {
    type CheckerboardType,
    type GeometryAndMaterial,
    type VertexData,
    type VoxelsChunkData,
} from '../../voxels-renderable-factory-base';
import { type CheckerboardCellId } from '../vertex-data2-encoder';
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
    buildIndexUnsafe(position: THREE.Vector3Like): number;
    neighbourExists(voxelIndex: number, neighbourRelativePosition: THREE.Vector3Like): boolean;
};

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType | undefined;
    readonly greedyMeshing?: boolean | undefined;
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

        checkerboardPattern: {
            x: +this.checkerboardType.includes('x'),
            y: +this.checkerboardType.includes('y'),
            z: +this.checkerboardType.includes('z'),
        },

        greedyMeshing: true,

        buildBuffer(voxelsChunkData: VoxelsChunkData): Uint32Array {
            if (voxelsChunkData.isEmpty) {
                return new Uint32Array();
            }

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

            const verticesData1 = new Uint32Array(4);
            const registerFace = (faceData: FaceData, checkerboardCellId: CheckerboardCellId, repeatX: number) => {
                faceData.verticesData.forEach((faceVertexData: VertexData, faceVertexIndex: number) => {
                    verticesData1[faceVertexIndex] = this.vertexData1Encoder.encode(
                        {
                            x: faceData.voxelLocalPosition.x + faceVertexData.localPosition.x * (1 + repeatX),
                            y: faceData.voxelLocalPosition.y + faceVertexData.localPosition.y,
                            z: faceData.voxelLocalPosition.z + faceVertexData.localPosition.z,
                        },
                        faceData.faceId,
                        faceVertexData.ao,
                        [faceVertexData.roundnessX, faceVertexData.roundnessY]
                    );
                });

                const vertexData2 = this.vertexData2Encoder.encode(
                    faceData.voxelMaterialId,
                    checkerboardCellId,
                    this.cube.faces[faceData.faceType].normal.id,
                    this.cube.faces[faceData.faceType].uvRight.id
                );

                for (const faceVertexIndex of this.cube.faceIndices) {
                    const vertexIndexInBuffer = uint32PerVertex * bufferData.verticesCount++;
                    bufferData.buffer[vertexIndexInBuffer] = verticesData1[faceVertexIndex]!;
                    bufferData.buffer[vertexIndexInBuffer + 1] = vertexData2;
                }
            };

            const computeCheckerboardCellId = (voxelIsCheckerboard: boolean, voxelLocalPosition: THREE.Vector3Like): CheckerboardCellId => {
                if (!voxelIsCheckerboard) {
                    return 0;
                }
                const color =
                    this.checkerboardPattern.x * voxelLocalPosition.x +
                    this.checkerboardPattern.y * voxelLocalPosition.y +
                    this.checkerboardPattern.z * voxelLocalPosition.z;

                return (1 + (color % 2)) as CheckerboardCellId;
            };

            const voxelsChunkCache = this.buildLocalMapCache(voxelsChunkData);

            if (!this.greedyMeshing) {
                for (const faceData of this.iterateOnVisibleFacesWithCache(voxelsChunkCache)) {
                    const checkerboardCellId = computeCheckerboardCellId(faceData.voxelIsCheckerboard, faceData.voxelLocalPosition);
                    registerFace(faceData, checkerboardCellId, 0);
                }
            } else {
                type ReferenceFaceData = {
                    readonly faceData: FaceData;
                    readonly checkerboardCellId: CheckerboardCellId;
                    repeatX: number;
                };
                const referenceFacesData: Record<Cube.FaceType, ReferenceFaceData | null> = {
                    up: null,
                    down: null,
                    left: null,
                    right: null,
                    front: null,
                    back: null,
                };
                for (const faceData of this.iterateOnVisibleFacesWithCache(voxelsChunkCache)) {
                    const referenceFaceData = referenceFacesData[faceData.faceType];
                    if (referenceFaceData) {
                        let mergeWithPreviousFace =
                            referenceFaceData.faceData.voxelMaterialId === faceData.voxelMaterialId &&
                            !referenceFaceData.faceData.voxelIsCheckerboard &&
                            !faceData.voxelIsCheckerboard &&
                            referenceFaceData.faceData.voxelLocalPosition.x + referenceFaceData.repeatX + 1 ===
                                faceData.voxelLocalPosition.x &&
                            referenceFaceData.faceData.voxelLocalPosition.y === faceData.voxelLocalPosition.y &&
                            referenceFaceData.faceData.voxelLocalPosition.z === faceData.voxelLocalPosition.z &&
                            !['left', 'right'].includes(referenceFaceData.faceData.faceType);

                        for (let iV = 0; iV < 4 && mergeWithPreviousFace; iV++) {
                            mergeWithPreviousFace &&= referenceFaceData.faceData.verticesData[iV]!.ao === faceData.verticesData[iV]!.ao;
                            mergeWithPreviousFace &&=
                                referenceFaceData.faceData.verticesData[iV]!.roundnessX === faceData.verticesData[iV]!.roundnessX;
                            mergeWithPreviousFace &&=
                                referenceFaceData.faceData.verticesData[iV]!.roundnessY === faceData.verticesData[iV]!.roundnessY;
                        }

                        if (mergeWithPreviousFace) {
                            referenceFaceData.repeatX++;
                        } else {
                            registerFace(referenceFaceData.faceData, referenceFaceData.checkerboardCellId, referenceFaceData.repeatX);
                            referenceFacesData[faceData.faceType] = {
                                faceData,
                                checkerboardCellId: computeCheckerboardCellId(faceData.voxelIsCheckerboard, faceData.voxelLocalPosition),
                                repeatX: 0,
                            };
                        }
                    } else {
                        referenceFacesData[faceData.faceType] = {
                            faceData,
                            checkerboardCellId: computeCheckerboardCellId(faceData.voxelIsCheckerboard, faceData.voxelLocalPosition),
                            repeatX: 0,
                        };
                    }
                }

                for (const referenceFaceData of Object.values(referenceFacesData)) {
                    if (referenceFaceData) {
                        registerFace(referenceFaceData.faceData, referenceFaceData.checkerboardCellId, referenceFaceData.repeatX);
                    }
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
                buildIndexUnsafe,
                neighbourExists,
            });
        },

        *iterateOnVisibleFacesWithCache(voxelsChunkCache: VoxelsChunkCache): Generator<FaceData> {
            if (voxelsChunkCache.isEmpty) {
                return;
            }

            const localPosition = { x: 0, y: 0, z: 0 };
            for (localPosition.z = 0; localPosition.z < voxelsChunkCache.size.z; localPosition.z++) {
                for (localPosition.y = 0; localPosition.y < voxelsChunkCache.size.y; localPosition.y++) {
                    for (localPosition.x = 0; localPosition.x < voxelsChunkCache.size.x; localPosition.x++) {
                        const cacheIndex = voxelsChunkCache.buildIndexUnsafe(localPosition);
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
                                const voxelMaterialId = this.voxelmapDataPacking.getMaterialId(cacheData);
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
                    }
                }
            }
        },
    };

    public constructor(params: Parameters) {
        super(params);

        this.serializableFactory.greedyMeshing = params.greedyMeshing ?? true;
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
    checkerboardPattern: ${JSON.stringify(this.serializableFactory.checkerboardPattern)},
    greedyMeshing: ${this.serializableFactory.greedyMeshing},
    ${this.serializableFactory.buildBuffer},
    ${this.serializableFactory.buildLocalMapCache},
    ${this.serializableFactory.iterateOnVisibleFacesWithCache},
}`;
    }
}

export { VoxelsRenderableFactoryCpu };
