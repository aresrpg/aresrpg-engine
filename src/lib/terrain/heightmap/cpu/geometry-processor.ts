import { type SyncOrPromise } from '../../../helpers/async/async-sync';
import { DedicatedWorkersPool } from '../../../helpers/async/dedicatedWorkers/dedicated-workers-pool';

type IndexedGeometryData = {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly indices: Uint16Array;
};

type ProcessedGeometryData = {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly normals: Float32Array;
    readonly indices?: Uint16Array;
};

type Parameters = {
    readonly outputIndexedGeometry: boolean;
    readonly dedicatedThreadsCount: number; // 0 for main thread; 1 or more for 1 or more dedicated threads
};

class GeometryProcessor {
    private readonly processor = {
        desindexBuffers(
            positions: Float32Array,
            colors: Float32Array,
            indices: Uint16Array
        ): { positions: Float32Array; colors: Float32Array } {
            const unindexedPositions = new Float32Array(3 * indices.length);
            const unindexedColors = new Float32Array(3 * indices.length);

            for (let indexId = 0; indexId < indices.length; indexId++) {
                const index = indices[indexId]!;
                unindexedPositions.set(positions.subarray(3 * index, 3 * index + 3), 3 * indexId);
                unindexedColors.set(colors.subarray(3 * index, 3 * index + 3), 3 * indexId);
            }

            return { positions: unindexedPositions, colors: unindexedColors };
        },

        computeVertexNormals(params: { positions: Float32Array; indices?: Uint16Array }): Float32Array {
            const { positions, indices } = params;

            const verticesCount = positions.length / 3;

            const normal = new Float32Array(3 * verticesCount);

            if (indices) {
                const trianglesCount = indices.length / 3;
                for (let iTriangle = 0; iTriangle < trianglesCount; iTriangle++) {
                    const i1 = indices[3 * iTriangle + 0]!;
                    const i2 = indices[3 * iTriangle + 1]!;
                    const i3 = indices[3 * iTriangle + 2]!;

                    const v1x = positions[3 * i1 + 0]!;
                    const v1y = positions[3 * i1 + 1]!;
                    const v1z = positions[3 * i1 + 2]!;

                    const v2x = positions[3 * i2 + 0]!;
                    const v2y = positions[3 * i2 + 1]!;
                    const v2z = positions[3 * i2 + 2]!;

                    const v3x = positions[3 * i3 + 0]!;
                    const v3y = positions[3 * i3 + 1]!;
                    const v3z = positions[3 * i3 + 2]!;

                    const v32x = v3x - v2x;
                    const v32y = v3y - v2y;
                    const v32z = v3z - v2z;

                    const v21x = v2x - v1x;
                    const v21y = v2y - v1y;
                    const v21z = v2z - v1z;

                    const nx = v32z * v21y - v32y * v21z;
                    const ny = v32x * v21z - v32z * v21x;
                    const nz = v32y * v21x - v32x * v21y;

                    normal[3 * i1 + 0]! += nx;
                    normal[3 * i1 + 1]! += ny;
                    normal[3 * i1 + 2]! += nz;
                    normal[3 * i2 + 0]! += nx;
                    normal[3 * i2 + 1]! += ny;
                    normal[3 * i2 + 2]! += nz;
                    normal[3 * i3 + 0]! += nx;
                    normal[3 * i3 + 1]! += ny;
                    normal[3 * i3 + 2]! += nz;
                }
            } else {
                const trianglesCount = verticesCount / 3;
                for (let iTriangle = 0; iTriangle < trianglesCount; iTriangle++) {
                    const triangleOffset = 9 * iTriangle;
                    const v1x = positions[triangleOffset + 0]!;
                    const v1y = positions[triangleOffset + 1]!;
                    const v1z = positions[triangleOffset + 2]!;

                    const v2x = positions[triangleOffset + 3]!;
                    const v2y = positions[triangleOffset + 4]!;
                    const v2z = positions[triangleOffset + 5]!;

                    const v3x = positions[triangleOffset + 6]!;
                    const v3y = positions[triangleOffset + 7]!;
                    const v3z = positions[triangleOffset + 8]!;

                    const v32x = v3x - v2x;
                    const v32y = v3y - v2y;
                    const v32z = v3z - v2z;

                    const v21x = v2x - v1x;
                    const v21y = v2y - v1y;
                    const v21z = v2z - v1z;

                    const nx = v32z * v21y - v32y * v21z;
                    const ny = v32x * v21z - v32z * v21x;
                    const nz = v32y * v21x - v32x * v21y;

                    normal[triangleOffset + 0] = nx;
                    normal[triangleOffset + 1] = ny;
                    normal[triangleOffset + 2] = nz;
                    normal[triangleOffset + 3] = nx;
                    normal[triangleOffset + 4] = ny;
                    normal[triangleOffset + 5] = nz;
                    normal[triangleOffset + 6] = nx;
                    normal[triangleOffset + 7] = ny;
                    normal[triangleOffset + 8] = nz;
                }
            }

            // normalize
            for (let iNormal = 0; iNormal < verticesCount; iNormal++) {
                const normalX = normal[3 * iNormal + 0]!;
                const normalY = normal[3 * iNormal + 1]!;
                const normalZ = normal[3 * iNormal + 2]!;
                const length = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
                if (length > 0) {
                    normal[3 * iNormal + 0]! /= length;
                    normal[3 * iNormal + 1]! /= length;
                    normal[3 * iNormal + 2]! /= length;
                }
            }

            return normal;
        },

        desindexAndComputeNormals(input: IndexedGeometryData): ProcessedGeometryData {
            const unindexed = this.desindexBuffers(input.positions, input.colors, input.indices);
            const normals = this.computeVertexNormals(unindexed);
            return {
                ...unindexed,
                normals,
            };
        },
    };

    private readonly outputIndexedGeometry: boolean;
    private readonly dedicatedThreadsCount: number; // 0 for main thread; 1 or more for 1 or more dedicated threads
    private workersPool: DedicatedWorkersPool | null = null;

    public constructor(params: Parameters) {
        this.outputIndexedGeometry = params.outputIndexedGeometry;
        this.dedicatedThreadsCount = params.dedicatedThreadsCount;

        if (!Number.isInteger(this.dedicatedThreadsCount) || this.dedicatedThreadsCount < 0) {
            throw new Error(`The parameter "dedicatedThreadsCount" must be a positive integer (received "${this.dedicatedThreadsCount}")`);
        }
    }

    public process(input: IndexedGeometryData): SyncOrPromise<ProcessedGeometryData> {
        if (this.dedicatedThreadsCount >= 1) {
            if (!this.workersPool) {
                this.workersPool = new DedicatedWorkersPool('geometry-processor', this.dedicatedThreadsCount, {
                    commonCode: `const processor = {
                        ${this.processor.desindexBuffers},
                        ${this.processor.computeVertexNormals},
                        ${this.processor.desindexAndComputeNormals},
                    };`,
                    tasks: {
                        computeIndexedNormals: (taskInput: { positions: Float32Array; index: Uint16Array }) => {
                            // eslint-disable-next-line no-eval
                            const processor2 = eval('processor') as GeometryProcessor['processor'];
                            const normals = processor2.computeVertexNormals(taskInput);
                            return {
                                taskResult: normals,
                                taskResultTransferablesList: [normals.buffer],
                            };
                        },
                        desindexAndComputeNormals: (taskInput: IndexedGeometryData) => {
                            // eslint-disable-next-line no-eval
                            const processor2 = eval('processor') as GeometryProcessor['processor'];
                            const result = processor2.desindexAndComputeNormals(taskInput);
                            return {
                                taskResult: result,
                                taskResultTransferablesList: [result.positions.buffer, result.colors.buffer, result.normals.buffer],
                            };
                        },
                    },
                });
            }

            if (this.outputIndexedGeometry) {
                return this.workersPool.submitTask('computeIndexedNormals', input).then(taskResult => {
                    const normals = taskResult as Float32Array;
                    return { ...input, normals };
                });
            } else {
                return this.workersPool.submitTask('desindexAndComputeNormals', input, [input.indices.buffer, input.positions.buffer]);
            }
        } else {
            if (this.outputIndexedGeometry) {
                const normals = this.processor.computeVertexNormals({ positions: input.positions, indices: input.indices });
                return { ...input, normals };
            } else {
                return this.processor.desindexAndComputeNormals(input);
            }
        }
    }
}

export { GeometryProcessor, type IndexedGeometryData, type ProcessedGeometryData };
