import * as THREE from '../../../libs/three-usage';
import { voxelEncoder, type VoxelsChunkOrdering } from '../i-voxelmap';
import { type VoxelsChunkData } from '../viewer/voxelmap-viewer';

type ChunkClutter = Map<number, ReadonlyArray<THREE.Matrix4>>;
type ChunkClutterRaw = Record<number, Float32Array>;
type ChunkClutterRawComputationInput = { chunkWorldOrigin: THREE.Vector3Like; voxelsChunkData: VoxelsChunkData };

class ClutterComputer {
    private readonly serializableFactory = {
        dataOrdering: 'zyx' as VoxelsChunkOrdering,

        clutterVoxelEncoder: voxelEncoder.clutterVoxel,

        computeChunkClutterRaw(input: ChunkClutterRawComputationInput): ChunkClutterRaw {
            const { chunkWorldOrigin, voxelsChunkData } = input;

            if (voxelsChunkData.isEmpty) {
                return {};
            }

            if (voxelsChunkData.dataOrdering !== this.dataOrdering) {
                throw new Error(
                    `Invalid voxels chunk ordering: expected "${this.dataOrdering}", received "${voxelsChunkData.dataOrdering}".`
                );
            }

            const chunkClutterArraysMap = new Map<number, number[]>();

            const localPosition = { x: 0, y: 0, z: 0 };
            for (localPosition.z = 1; localPosition.z < voxelsChunkData.size.z - 1; localPosition.z++) {
                for (localPosition.y = 1; localPosition.y < voxelsChunkData.size.y - 1; localPosition.y++) {
                    for (localPosition.x = 1; localPosition.x < voxelsChunkData.size.x - 1; localPosition.x++) {
                        const index =
                            localPosition.x + voxelsChunkData.size.x * (localPosition.y + voxelsChunkData.size.y * localPosition.z);
                        const data = voxelsChunkData.data[index];
                        if (typeof data === 'undefined') {
                            throw new Error();
                        }
                        if (this.clutterVoxelEncoder.isOfType(data)) {
                            const count = this.clutterVoxelEncoder.getCount(data);
                            const clutterId = this.clutterVoxelEncoder.getClutterId(data);
                            if (count > 0) {
                                let array = chunkClutterArraysMap.get(clutterId);
                                if (!array) {
                                    array = [];
                                    chunkClutterArraysMap.set(clutterId, array);
                                }

                                const tx = chunkWorldOrigin.x + localPosition.x - 1 + Math.random();
                                const ty = chunkWorldOrigin.y + localPosition.y - 1;
                                const tz = chunkWorldOrigin.z + localPosition.z - 1 + Math.random();

                                array.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1);
                            }
                        }
                    }
                }
            }

            const chunkClutterRaw: ChunkClutterRaw = {};
            for (const [clutterId, array] of chunkClutterArraysMap.entries()) {
                chunkClutterRaw[clutterId] = new Float32Array(array);
            }
            return chunkClutterRaw;
        },
    };

    protected computeChunkClutterRaw(input: ChunkClutterRawComputationInput): Promise<ChunkClutterRaw> {
        const result = this.serializableFactory.computeChunkClutterRaw(input);
        return Promise.resolve(result);
    }

    public async computeChunkClutter(chunkWorldOrigin: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<ChunkClutter> {
        const chunkClutterRaw = await this.computeChunkClutterRaw({ chunkWorldOrigin, voxelsChunkData });

        const chunkClutter: ChunkClutter = new Map();
        for (const [clutterIdString, float32Array] of Object.entries(chunkClutterRaw)) {
            const clutterId = Number(clutterIdString);
            if (isNaN(clutterId)) {
                throw new Error();
            }

            const matricesCount = float32Array.length / 16;
            if (!Number.isInteger(matricesCount)) {
                throw new Error();
            }

            const matricesList: THREE.Matrix4[] = [];
            for (let iM = 0; iM < matricesCount; iM++) {
                const matrix = new THREE.Matrix4().fromArray(float32Array.subarray(16 * iM, 16 * (iM + 1)));
                matricesList.push(matrix);
            }
            chunkClutter.set(clutterId, matricesList);
        }
        return chunkClutter;
    }

    protected serialize(): string {
        return `{
            dataOrdering: "${this.serializableFactory.dataOrdering}",
            clutterVoxelEncoder: ${this.serializableFactory.clutterVoxelEncoder.serialize()},
            ${this.serializableFactory.computeChunkClutterRaw},
        }`;
    }
}

export { ClutterComputer, type ChunkClutter, type ChunkClutterRaw, type ChunkClutterRawComputationInput };
