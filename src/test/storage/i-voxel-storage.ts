import * as THREE from "three";

interface IVoxel {
    readonly position: THREE.Vector3;
    readonly materialId: number;
};

interface IVoxelStorage {
    setVoxelMaterial(coords: THREE.Vector3, materialId: number): void;
    iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel>;
    doesVoxelExist(coords: THREE.Vector3): boolean;
}

export type { IVoxelStorage };

