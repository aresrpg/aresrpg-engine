import { type MeshesStatistics } from '../../helpers/meshes-statistics';
import type * as THREE from '../../libs/three-usage';

import type { VoxelsChunkSize } from './i-voxelmap';

type VoxelmapStatistics = MeshesStatistics & {
    chunkSize: THREE.Vector3Like;
};

interface IVoxelmapViewer {
    readonly container: THREE.Object3D;
    readonly chunkSize: VoxelsChunkSize;
    readonly onChange: VoidFunction[];
    getCompleteChunksColumns(): { x: number; z: number }[];
    update(): void;
    getStatistics(): VoxelmapStatistics;
}

export type { IVoxelmapViewer, VoxelmapStatistics };
