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
          readonly data: Uint16Array;
      };

type Parameters = {
    readonly chunkSize: THREE.Vector3Like;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

// const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xFF0000 }));

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
        const buildIndexFactor2 = (component: Component): number => {
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
            x: buildIndexFactor2('x'),
            y: buildIndexFactor2('y'),
            z: buildIndexFactor2('z'),
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
            this.chunkCollidersMap[patchId.asString] = { isEmpty: false, data: chunk.data };
        }

        this.chunkCollidersMap[patchId.asString] = chunk.isEmpty
            ? {
                  isEmpty: true,
              }
            : {
                  isEmpty: false,
                  data: new Uint16Array(chunk.data),
              };
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
        // console.log(localVoxelCoords);
        const index =
            localVoxelCoords.x * this.indexFactors.x + localVoxelCoords.y * this.indexFactors.y + localVoxelCoords.z * this.indexFactors.z;
        const voxel = chunk.data[index];
        if (typeof voxel === 'undefined') {
            throw new Error();
        }

        if (this.voxelmapDataPacking.isEmpty(voxel)) {
            return EVoxelStatus.EMPTY;
        }
        return EVoxelStatus.FULL;
    }
}

export { EVoxelStatus, VoxelmapCollider };
