import * as THREE from "three";
import { type IVoxelMaterial } from "../../lib";

enum EVoxelType {
    ROCK,
    GRASS,
    SNOW,
    WATER,
    SAND,
    TREE_TRUNK,
    TREE_LEAVES,
}

const voxelMaterials: Record<EVoxelType, IVoxelMaterial> = [
    { color: new THREE.Color('#ABABAB') },
    { color: new THREE.Color('#00B920') },
    { color: new THREE.Color('#E5E5E5') },
    { color: new THREE.Color('#0055E2') },
    { color: new THREE.Color('#DCBE28') },
    { color: new THREE.Color('#692D00') },
    { color: new THREE.Color('#007A00') },
];

export {
    EVoxelType,
    voxelMaterials
};
