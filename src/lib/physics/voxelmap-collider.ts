import { logger } from '../helpers/logger';
import type * as THREE from '../libs/three-usage';
import { type VoxelsChunkOrdering } from '../terrain/voxelmap/i-voxelmap';
import { PatchId } from '../terrain/voxelmap/patch/patch-id';
import { VoxelmapDataPacking } from '../terrain/voxelmap/voxelmap-data-packing';

enum EVoxelStatus {
    EMPTY,
    FULL,
    NOT_LOADED,
}

type ChunkData = {
    readonly data: Uint16Array;
    readonly dataOrdering: VoxelsChunkOrdering;
    readonly isEmpty: boolean;
};

type ChunkCollider =
    | {
          readonly isEmpty: true;
      }
    | {
          readonly isEmpty: false;
          readonly type: 'raw';
          readonly data: Uint16Array; // one uint16 per voxel
      }
    | {
          readonly isEmpty: false;
          readonly type: 'compressed';
          readonly data: Uint8Array; // one bit per voxel
      };

type Parameters = {
    readonly chunkSize: THREE.Vector3Like;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class VoxelmapCollider {
    private readonly chunkSize: THREE.Vector3Like;
    private readonly voxelsChunkOrdering: VoxelsChunkOrdering;
    private readonly indexFactors: THREE.Vector3Like;

    private readonly voxelmapDataPacking = new VoxelmapDataPacking();

    private readonly chunkCollidersMap: Record<string, ChunkCollider> = {};

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
    }

    public setChunk(chunkId: THREE.Vector3Like, chunk: ChunkData): void {
        if (chunk.dataOrdering !== this.voxelsChunkOrdering) {
            throw new Error(`Invalid voxels chunk ordering: expected "${this.voxelsChunkOrdering}", received "${chunk.dataOrdering}".`);
        }

        const patchId = new PatchId(chunkId);
        if (this.chunkCollidersMap[patchId.asString]) {
            throw new Error(`Chunk "${patchId.asString}" already exists.`);
        }

        if (chunk.isEmpty) {
            this.chunkCollidersMap[patchId.asString] = { isEmpty: true };
        } else {
            const rawChunkCollider: ChunkCollider = { isEmpty: false, type: 'raw', data: chunk.data };
            this.chunkCollidersMap[patchId.asString] = rawChunkCollider;

            setTimeout(() => {
                const data = new Uint8Array(Math.ceil(chunk.data.length / 8));
                for (let iZ = 0; iZ < this.chunkSize.z; iZ++) {
                    for (let iY = 0; iY < this.chunkSize.y; iY++) {
                        for (let iX = 0; iX < this.chunkSize.x; iX++) {
                            const voxelIndex = iX * this.indexFactors.x + iY * this.indexFactors.y + iZ * this.indexFactors.z;
                            const voxelData = chunk.data[voxelIndex];
                            if (typeof voxelData === 'undefined') {
                                throw new Error();
                            }
                            if (!this.voxelmapDataPacking.isEmpty(voxelData)) {
                                const uint8Index = Math.floor(voxelIndex / 8);
                                const bitIndex = voxelIndex - 8 * uint8Index;
                                data[uint8Index]! |= 1 << bitIndex;
                            }
                        }
                    }
                }

                if (this.chunkCollidersMap[patchId.asString] === rawChunkCollider) {
                    this.chunkCollidersMap[patchId.asString] = { isEmpty: false, type: 'compressed', data };
                } else {
                    logger.warn(`Chunk collider "${patchId.asString}" changed unexpectedly.`);
                }
            });
        }
    }

    public getVoxel(worldVoxelCoords: THREE.Vector3Like): EVoxelStatus {
        const patchId = new PatchId({
            x: Math.floor(worldVoxelCoords.x / this.chunkSize.x),
            y: Math.floor(worldVoxelCoords.y / this.chunkSize.y),
            z: Math.floor(worldVoxelCoords.z / this.chunkSize.z),
        });
        // console.log(patchId.asString);
        const chunk = this.chunkCollidersMap[patchId.asString];
        if (!chunk) {
            return EVoxelStatus.NOT_LOADED;
        }

        if (chunk.isEmpty) {
            return EVoxelStatus.EMPTY;
        }

        const localVoxelCoords = {
            x: worldVoxelCoords.x - patchId.x * this.chunkSize.x + 1,
            y: worldVoxelCoords.y - patchId.y * this.chunkSize.y + 1,
            z: worldVoxelCoords.z - patchId.z * this.chunkSize.z + 1,
        };

        const voxelIndex =
            localVoxelCoords.x * this.indexFactors.x + localVoxelCoords.y * this.indexFactors.y + localVoxelCoords.z * this.indexFactors.z;

        if (chunk.type === 'compressed') {
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

            if (this.voxelmapDataPacking.isEmpty(voxel)) {
                return EVoxelStatus.EMPTY;
            }
            return EVoxelStatus.FULL;
        }
    }
}

export { EVoxelStatus, VoxelmapCollider };
