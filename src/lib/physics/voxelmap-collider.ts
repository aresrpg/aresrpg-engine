import { type WorkerDefinition } from '../helpers/async/dedicatedWorkers/dedicated-worker';
import { DedicatedWorkersPool } from '../helpers/async/dedicatedWorkers/dedicated-workers-pool';
import { logger } from '../helpers/logger';
import type * as THREE from '../libs/three-usage';
import { ChunkId } from '../terrain/voxelmap/chunk/chunk-id';
import { VoxelEncoder } from '../terrain/voxelmap/encoding/voxel-encoder';
import { type VoxelsChunkOrdering } from '../terrain/voxelmap/i-voxelmap';
import { type VoxelsChunkData } from '../terrain/voxelmap/voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { EVoxelStatus, type IVoxelmapCollider } from './i-voxelmap-collider';

type ChunkCollider =
    | {
          readonly isEmpty: true;
          readonly isFull: false;
      }
    | {
          readonly isEmpty: false;
          readonly isFull: true;
      }
    | {
          readonly isEmpty: false;
          readonly isFull: false;
          readonly type: 'raw';
          readonly data: Uint16Array; // one uint16 per voxel
      }
    | {
          readonly isEmpty: false;
          readonly isFull: false;
          readonly type: 'compacted';
          readonly data: Uint8Array; // one bit per voxel
      };

type Parameters = {
    readonly chunkSize: THREE.Vector3Like;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

type VoxelmapColliderStatistics = {
    totalChunksCount: number;
    totalMemoryBytes: number;
    compactedChunks: {
        count: number;
        totalMemoryBytes: number;
    };
    rawChunks: {
        count: number;
        totalMemoryBytes: number;
    };
};

type VoxelsChunkDataForCollisions =
    | (VoxelsChunkData & { readonly isFull: false })
    | {
          readonly isEmpty: false;
          readonly isFull: true;
      };

class VoxelmapCollider implements IVoxelmapCollider {
    private readonly chunkSize: THREE.Vector3Like;
    private readonly voxelsChunkOrdering: VoxelsChunkOrdering;
    private readonly indexFactors: THREE.Vector3Like;

    private readonly voxelEncoder = new VoxelEncoder();

    private readonly chunkCollidersMap = new Map<string, ChunkCollider>();

    private readonly compactionWorkersPool: DedicatedWorkersPool | null = null;

    private readonly compactor = {
        voxelEncoder: this.voxelEncoder,

        compactChunk(rawData: Uint16Array): Uint8Array {
            const compactedData = new Uint8Array(Math.ceil(rawData.length / 8));
            for (let iVoxelIndex = 0; iVoxelIndex < rawData.length; iVoxelIndex++) {
                const voxelData = rawData[iVoxelIndex]!;
                if (this.voxelEncoder.solidVoxel.isSolidVoxel(voxelData)) {
                    const uint8Index = Math.floor(iVoxelIndex / 8);
                    const bitIndex = iVoxelIndex - 8 * uint8Index;
                    compactedData[uint8Index]! |= 1 << bitIndex;
                }
            }
            return compactedData;
        },
    };

    public constructor(params: Parameters) {
        this.chunkSize = params.chunkSize;
        this.voxelsChunkOrdering = params.voxelsChunkOrdering;

        const margins = 2;
        type Component = 'x' | 'y' | 'z';
        const buildIndexFactorComponent = (component: Component): number => {
            const sanitizeXYZ = (s: string | undefined): Component => {
                if (s === 'x' || s === 'y' || s === 'z') {
                    return s;
                }
                throw new Error(`Invalid voxelsChunkOrdering "${params.voxelsChunkOrdering}".`);
            };

            const components0 = sanitizeXYZ(params.voxelsChunkOrdering[0]);
            const components1 = sanitizeXYZ(params.voxelsChunkOrdering[1]);
            const components2 = sanitizeXYZ(params.voxelsChunkOrdering[2]);
            if (component === components2) {
                return 1;
            } else if (component === components1) {
                return params.chunkSize[components2] + margins;
            } else if (component === components0) {
                return (params.chunkSize[components2] + margins) * (params.chunkSize[components1] + margins);
            } else {
                throw new Error(`Invalid voxelsChunkOrdering "${params.voxelsChunkOrdering}".`);
            }
        };

        this.indexFactors = {
            x: buildIndexFactorComponent('x'),
            y: buildIndexFactorComponent('y'),
            z: buildIndexFactorComponent('z'),
        };

        const delegateCompressionToWorker = true as boolean;
        if (delegateCompressionToWorker) {
            const compactionWorkerDefinition: WorkerDefinition = {
                commonCode: `const compactor = {
                voxelEncoder: ${this.compactor.voxelEncoder.serialize()},
                ${this.compactor.compactChunk},
            };`,
                tasks: {
                    compactChunk: (rawData: Uint16Array) => {
                        // eslint-disable-next-line no-eval
                        const compactor2 = eval('compactor') as VoxelmapCollider['compactor'];
                        const buffer = compactor2.compactChunk(rawData);
                        return {
                            taskResult: buffer,
                            taskResultTransferablesList: [buffer.buffer],
                        };
                    },
                },
            };

            this.compactionWorkersPool = new DedicatedWorkersPool('voxelmap-collider-compaction-worker', 1, compactionWorkerDefinition);
        }
    }

    public setChunk(chunkId: THREE.Vector3Like, chunk: VoxelsChunkDataForCollisions): void {
        const chunkIdString = new ChunkId(chunkId).asString;
        if (this.chunkCollidersMap.has(chunkIdString)) {
            logger.debug(`Chunk "${chunkIdString}" already exists.`);
        }

        if (chunk.isEmpty) {
            this.chunkCollidersMap.set(chunkIdString, { isEmpty: true, isFull: false });
        } else if (chunk.isFull) {
            this.chunkCollidersMap.set(chunkIdString, { isEmpty: false, isFull: true });
        } else {
            if (chunk.dataOrdering !== this.voxelsChunkOrdering) {
                throw new Error(`Invalid voxels chunk ordering: expected "${this.voxelsChunkOrdering}", received "${chunk.dataOrdering}".`);
            }

            if (this.compactionWorkersPool) {
                const rawChunkCollider: ChunkCollider = { isEmpty: false, isFull: false, type: 'raw', data: chunk.data };
                this.chunkCollidersMap.set(chunkIdString, rawChunkCollider);
                this.compactionWorkersPool.submitTask<Uint8Array>('compactChunk', chunk.data).then(data => {
                    if (this.chunkCollidersMap.get(chunkIdString) === rawChunkCollider) {
                        this.chunkCollidersMap.set(chunkIdString, {
                            isEmpty: false,
                            isFull: false,
                            type: 'compacted',
                            data,
                        });
                    } else {
                        logger.warn(`Chunk collider "${chunkIdString}" changed unexpectedly.`);
                    }
                });
            } else {
                this.chunkCollidersMap.set(chunkIdString, {
                    isEmpty: false,
                    isFull: false,
                    type: 'compacted',
                    data: this.compactor.compactChunk(chunk.data),
                });
            }
        }
    }

    public getVoxel(worldVoxelCoords: THREE.Vector3Like): EVoxelStatus {
        const chunkId = new ChunkId({
            x: Math.floor(worldVoxelCoords.x / this.chunkSize.x),
            y: Math.floor(worldVoxelCoords.y / this.chunkSize.y),
            z: Math.floor(worldVoxelCoords.z / this.chunkSize.z),
        });
        const chunk = this.chunkCollidersMap.get(chunkId.asString);
        if (!chunk) {
            return EVoxelStatus.NOT_LOADED;
        }

        if (chunk.isEmpty) {
            return EVoxelStatus.EMPTY;
        } else if (chunk.isFull) {
            return EVoxelStatus.FULL;
        }

        const localVoxelCoords = {
            x: worldVoxelCoords.x - chunkId.x * this.chunkSize.x + 1,
            y: worldVoxelCoords.y - chunkId.y * this.chunkSize.y + 1,
            z: worldVoxelCoords.z - chunkId.z * this.chunkSize.z + 1,
        };

        const voxelIndex =
            localVoxelCoords.x * this.indexFactors.x + localVoxelCoords.y * this.indexFactors.y + localVoxelCoords.z * this.indexFactors.z;

        if (chunk.type === 'compacted') {
            const uint8Index = Math.floor(voxelIndex / 8);
            const uint8 = chunk.data[uint8Index];
            if (typeof uint8 === 'undefined') {
                throw new Error();
            }

            const bitIndex = voxelIndex - 8 * uint8Index;
            if (uint8 & (1 << bitIndex)) {
                return EVoxelStatus.FULL;
            }
            return EVoxelStatus.EMPTY;
        } else {
            const voxel = chunk.data[voxelIndex];
            if (typeof voxel === 'undefined') {
                throw new Error();
            }

            if (this.voxelEncoder.solidVoxel.isSolidVoxel(voxel)) {
                return EVoxelStatus.FULL;
            }
            return EVoxelStatus.EMPTY;
        }
    }

    public getStatistics(): VoxelmapColliderStatistics {
        const statistics: VoxelmapColliderStatistics = {
            totalChunksCount: 0,
            totalMemoryBytes: 0,
            compactedChunks: {
                count: 0,
                totalMemoryBytes: 0,
            },
            rawChunks: {
                count: 0,
                totalMemoryBytes: 0,
            },
        };

        for (const chunk of this.chunkCollidersMap.values()) {
            statistics.totalChunksCount++;

            if (!chunk.isEmpty && !chunk.isFull) {
                if (chunk.type === 'compacted') {
                    statistics.compactedChunks.count++;
                    statistics.compactedChunks.totalMemoryBytes += chunk.data.byteLength;
                } else {
                    statistics.rawChunks.count++;
                    statistics.rawChunks.totalMemoryBytes += chunk.data.byteLength;
                }
                statistics.totalMemoryBytes += chunk.data.byteLength;
            }
        }
        return statistics;
    }
}

export { VoxelmapCollider };
