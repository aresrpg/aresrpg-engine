import { createNoise2D } from 'simplex-noise';
import * as THREE from 'three';

import type { ILocalMapData, IVoxelMap, IVoxelMaterial } from '../lib/index';

enum EVoxelType {
    ROCK,
    GRASS,
    SNOW,
    WATER,
    SAND,
}

interface IVoxel {
    readonly position: THREE.Vector3Like;
    readonly materialId: number;
}

const voxelMaterials: Record<EVoxelType, IVoxelMaterial> = [
    { color: new THREE.Color('#ABABAB') },
    { color: new THREE.Color('#00B920') },
    { color: new THREE.Color('#E5E5E5') },
    { color: new THREE.Color('#0055E2') },
    { color: new THREE.Color('#DCBE28') },
];

type StoredVoxel = {
    readonly y: number;
    readonly type: EVoxelType;
};

class VoxelMap implements IVoxelMap {
    public readonly size: THREE.Vector3;
    public readonly voxelMaterialsList = Object.values(voxelMaterials);

    private readonly voxels: ReadonlyArray<StoredVoxel>;
    private readonly coordsShift: THREE.Vector3;

    public constructor(width: number, height: number, altitude: number) {
        this.size = new THREE.Vector3(width, altitude, height);

        const centerMap = true;
        if (centerMap) {
            this.coordsShift = this.size.clone().multiplyScalar(-0.5).floor();
        } else {
            this.coordsShift = new THREE.Vector3(0, 0, 0);
        }

        const noise2D = createNoise2D();

        const voxels: StoredVoxel[] = [];
        for (let iX = 0; iX < this.size.x; iX++) {
            for (let iZ = 0; iZ < this.size.z; iZ++) {
                const yNoise = 0.5 + 0.5 * noise2D(iX / 50, iZ / 50);
                const iY = Math.floor(yNoise * this.size.y);
                const id = this.buildId(iX, iZ);

                let type: EVoxelType;
                if (iY < 0.1 * altitude) {
                    type = EVoxelType.WATER;
                } else if (iY < 0.3 * altitude) {
                    type = EVoxelType.SAND;
                } else if (iY < 0.75 * altitude) {
                    type = EVoxelType.GRASS;
                } else if (iY < 0.85 * altitude) {
                    type = EVoxelType.ROCK;
                } else {
                    type = EVoxelType.SNOW;
                }
                voxels[id] = {
                    y: iY,
                    type,
                };
            }
        }
        this.voxels = voxels;

        console.log(`Generated map of size ${this.size.x}x${this.size.y}x${this.size.z} (${this.voxels.length.toLocaleString()} voxels)`);
    }

    public async getLocalMapData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<ILocalMapData> {
        const cacheStart = patchStart.clone().subScalar(1);
        const cacheEnd = patchEnd.clone().addScalar(1);
        const cacheSize = new THREE.Vector3().subVectors(cacheEnd, cacheStart);
        const cache = new Uint16Array(cacheSize.x * cacheSize.y * cacheSize.z);

        const indexFactor = { x: 1, y: cacheSize.x, z: cacheSize.x * cacheSize.y };

        const buildIndex = (position: THREE.Vector3) => {
            if (position.x < 0 || position.y < 0 || position.z < 0) {
                throw new Error();
            }
            return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
        };

        let isEmpty = true;
        for (const voxel of this.iterateOnVoxels(cacheStart, cacheEnd)) {
            const localPosition = new THREE.Vector3().subVectors(voxel.position, cacheStart);
            const cacheIndex = buildIndex(localPosition);
            cache[cacheIndex] = 1 + voxel.materialId;
            isEmpty = false;
        }

        return {
            data: cache,
            isEmpty,
        };
    }

    private *iterateOnVoxels(from: THREE.Vector3, to: THREE.Vector3): Generator<IVoxel> {
        if (to.x < from.x || to.y < from.y || to.z < from.z) {
            throw new Error();
        }

        const position = new THREE.Vector3();
        for (position.x = from.x; position.x < to.x; position.x++) {
            for (position.z = from.z; position.z < to.z; position.z++) {
                const voxel = this.getVoxel(position.x, position.z);
                if (voxel) {
                    position.y = voxel.y;
                    if (from.y <= position.y && position.y < to.y) {
                        yield {
                            position,
                            materialId: voxel.type,
                        };
                    }
                }
            }
        }
    }

    private getVoxel(x: number, z: number): StoredVoxel | null {
        x -= this.coordsShift.x;
        z -= this.coordsShift.z;
        if (x >= 0 && x < this.size.x && z >= 0 && z < this.size.z) {
            const index = this.buildId(x, z);
            return this.voxels[index] || null;
        }
        return null;
    }

    private buildId(x: number, z: number): number {
        return x * this.size.z + z;
    }
}

export { VoxelMap };
