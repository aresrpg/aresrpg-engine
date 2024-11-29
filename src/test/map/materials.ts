import * as THREE from 'three-usage-test';

import { type IVoxelMaterial } from '../../lib';

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
    { color: new THREE.Color('#ABABAB'), shininess: 0 },
    { color: new THREE.Color('#00B920'), shininess: 1 },
    { color: new THREE.Color('#E5E5E5'), shininess: 10 },
    { color: new THREE.Color('#0055E2'), shininess: 30 },
    { color: new THREE.Color('#DCBE28'), shininess: 10 },
    { color: new THREE.Color('#692D00'), shininess: 0 },
    { color: new THREE.Color('#007A00'), shininess: 5 },
];

export { EVoxelType, voxelMaterials };
