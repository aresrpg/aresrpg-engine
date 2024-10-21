import type * as THREE from '../libs/three-usage';

enum EVoxelStatus {
    EMPTY,
    FULL,
    NOT_LOADED,
}

interface IVoxelmapCollider {
    getVoxel(worldVoxelCoords: THREE.Vector3Like): EVoxelStatus;
}

export { EVoxelStatus, type IVoxelmapCollider };
