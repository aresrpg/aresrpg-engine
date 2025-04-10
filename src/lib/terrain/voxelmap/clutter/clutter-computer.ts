import * as THREE from '../../../libs/three-usage';
import { voxelEncoder, type VoxelsChunkOrdering } from '../i-voxelmap';
import { type VoxelsChunkData } from '../viewer/voxelmap-viewer';

type ChunkClutter = Map<number, ReadonlyArray<THREE.Matrix4>>;
type ChunkClutterRaw = Record<number, Float32Array>;
type ChunkClutterRawComputationInput = { chunkWorldOrigin: THREE.Vector3Like; voxelsChunkData: VoxelsChunkData };

type Params = {
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

type VoxelsChunkDataSample = {
    readonly data: number;
    readonly localPosition: THREE.Vector3Like;
};

class ClutterComputer {
    private readonly serializableFactory = {
        voxelsChunkOrdering: 'zyx' as VoxelsChunkOrdering,

        clutterVoxelEncoder: voxelEncoder.clutterVoxel,

        computeChunkClutterRaw(input: ChunkClutterRawComputationInput): ChunkClutterRaw {
            const { chunkWorldOrigin, voxelsChunkData } = input;

            if (voxelsChunkData.isEmpty) {
                return {};
            }

            if (voxelsChunkData.dataOrdering !== this.voxelsChunkOrdering) {
                throw new Error(
                    `Invalid voxels chunk ordering: expected "${this.voxelsChunkOrdering}", received "${voxelsChunkData.dataOrdering}".`
                );
            }

            const chunkClutterArraysMap = new Map<number, number[]>();

            for (const { localPosition, data } of this.iterateOnVoxelsChunkData(voxelsChunkData)) {
                if (this.clutterVoxelEncoder.isOfType(data)) {
                    const count = this.clutterVoxelEncoder.getCount(data);
                    const clutterId = this.clutterVoxelEncoder.getClutterId(data);
                    for (let iC = 0; iC < count; iC++) {
                        let array = chunkClutterArraysMap.get(clutterId);
                        if (!array) {
                            array = [];
                            chunkClutterArraysMap.set(clutterId, array);
                        }

                        const s = 1 + 0.5 * Math.random();

                        const a = 2 * Math.PI * Math.random();
                        const ca = Math.cos(a);
                        const sa = Math.sin(a);

                        const tx = chunkWorldOrigin.x + localPosition.x - 1 + Math.random();
                        const ty = chunkWorldOrigin.y + localPosition.y - 1;
                        const tz = chunkWorldOrigin.z + localPosition.z - 1 + Math.random();

                        array.push(s * ca, 0, sa, 0, 0, s, 0, 0, -sa, 0, s * ca, 0, tx, ty, tz, 1);
                    }
                }
            }

            const chunkClutterRaw: ChunkClutterRaw = {};
            for (const [clutterId, array] of chunkClutterArraysMap.entries()) {
                chunkClutterRaw[clutterId] = new Float32Array(array);
            }
            return chunkClutterRaw;
        },

        *iterateOnVoxelsChunkData(voxelsChunkData: VoxelsChunkData): Generator<VoxelsChunkDataSample> {
            if (voxelsChunkData.isEmpty) {
                return;
            }

            type Component = 'x' | 'y' | 'z';
            const buildIndexFactorComponent = (component: Component): number => {
                const sanitizeXYZ = (s: string | undefined): Component => {
                    if (s === 'x' || s === 'y' || s === 'z') {
                        return s;
                    }
                    throw new Error(`Invalid voxelsChunkOrdering "${this.voxelsChunkOrdering}".`);
                };

                const components0 = sanitizeXYZ(this.voxelsChunkOrdering[0]);
                const components1 = sanitizeXYZ(this.voxelsChunkOrdering[1]);
                const components2 = sanitizeXYZ(this.voxelsChunkOrdering[2]);
                if (component === components2) {
                    return 1;
                } else if (component === components1) {
                    return voxelsChunkData.size[components2];
                } else if (component === components0) {
                    return voxelsChunkData.size[components2] * voxelsChunkData.size[components1];
                } else {
                    throw new Error(`Invalid voxelsChunkOrdering "${this.voxelsChunkOrdering}".`);
                }
            };

            const indexFactor = {
                x: buildIndexFactorComponent('x'),
                y: buildIndexFactorComponent('y'),
                z: buildIndexFactorComponent('z'),
            };

            const buildIndexUnsafe = (position: THREE.Vector3Like) => {
                return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
            };

            const localPosition = { x: 0, y: 0, z: 0 };

            for (localPosition.z = 1; localPosition.z < voxelsChunkData.size.z - 1; localPosition.z++) {
                for (localPosition.y = 1; localPosition.y < voxelsChunkData.size.y - 1; localPosition.y++) {
                    for (localPosition.x = 1; localPosition.x < voxelsChunkData.size.x - 1; localPosition.x++) {
                        const index = buildIndexUnsafe(localPosition);
                        const data = voxelsChunkData.data[index];
                        if (typeof data === 'undefined') {
                            throw new Error();
                        }
                        yield { data, localPosition };
                    }
                }
            }
        },
    };

    public constructor(params: Params) {
        this.serializableFactory.voxelsChunkOrdering = params.voxelsChunkOrdering;
    }

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
            voxelsChunkOrdering: "${this.serializableFactory.voxelsChunkOrdering}",
            clutterVoxelEncoder: ${this.serializableFactory.clutterVoxelEncoder.serialize()},
            ${this.serializableFactory.computeChunkClutterRaw},
            ${this.serializableFactory.iterateOnVoxelsChunkData},
        }`;
    }
}

export { ClutterComputer, type ChunkClutter, type ChunkClutterRaw, type ChunkClutterRawComputationInput };
