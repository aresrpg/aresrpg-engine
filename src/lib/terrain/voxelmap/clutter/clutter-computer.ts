import * as THREE from '../../../libs/three-usage';
import { voxelEncoder, type VoxelsChunkOrdering } from '../i-voxelmap';
import { type VoxelsChunkData } from '../viewer/voxelmap-viewer';

type ChunkClutter = Map<number, ReadonlyArray<THREE.Matrix4>>;

class ClutterComputer {
    public readonly dataOrdering: VoxelsChunkOrdering = 'zyx';

    public computeChunkClutter(chunkWorldOrigin: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<ChunkClutter> {
        if (voxelsChunkData.isEmpty) {
            return Promise.resolve(new Map());
        }

        if (voxelsChunkData.dataOrdering !== this.dataOrdering) {
            throw new Error(`Invalid voxels chunk ordering: expected "${this.dataOrdering}", received "${voxelsChunkData.dataOrdering}".`);
        }

        const chunkClutter = new Map<number, THREE.Matrix4[]>();

        const localPosition = { x: 0, y: 0, z: 0 };
        for (localPosition.z = 1; localPosition.z < voxelsChunkData.size.z - 1; localPosition.z++) {
            for (localPosition.y = 1; localPosition.y < voxelsChunkData.size.y - 1; localPosition.y++) {
                for (localPosition.x = 1; localPosition.x < voxelsChunkData.size.x - 1; localPosition.x++) {
                    const index = localPosition.x + voxelsChunkData.size.x * (localPosition.y + voxelsChunkData.size.y * localPosition.z);
                    const data = voxelsChunkData.data[index];
                    if (typeof data === 'undefined') {
                        throw new Error();
                    }
                    if (voxelEncoder.clutterVoxel.isOfType(data)) {
                        const count = voxelEncoder.clutterVoxel.getCount(data);
                        const clutterId = voxelEncoder.clutterVoxel.getClutterId(data);
                        if (count > 0) {
                            let matrices = chunkClutter.get(clutterId);
                            if (!matrices) {
                                matrices = [];
                                chunkClutter.set(clutterId, matrices);
                            }
                            matrices.push(
                                new THREE.Matrix4().makeTranslation(
                                    chunkWorldOrigin.x + localPosition.x - 1 + Math.random(),
                                    chunkWorldOrigin.y + localPosition.y - 1,
                                    chunkWorldOrigin.z + localPosition.z - 1 + Math.random()
                                )
                            );
                        }
                    }
                }
            }
        }

        return Promise.resolve(chunkClutter);
    }
}

export { ClutterComputer, type ChunkClutter };
