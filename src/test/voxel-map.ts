import alea from 'alea';
import { type NoiseFunction2D, createNoise2D } from 'simplex-noise';
import * as THREE from 'three';

import { type IHeightmap, type IHeightmapCoords, type IHeightmapSample, type ILocalMapData, type IVoxelMap, type IVoxelMaterial } from '../lib/index';

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

class VoxelMap implements IVoxelMap, IHeightmap {
    public readonly size: THREE.Vector3;
    public readonly voxelMaterialsList = Object.values(voxelMaterials);

    private readonly noise2D: NoiseFunction2D;
    private readonly voxels: ReadonlyArray<StoredVoxel>;
    private readonly coordsShift: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    public constructor(width: number, height: number, altitude: number, seed: string) {
        this.size = new THREE.Vector3(width, altitude, height);

        const prng = alea(seed);
        this.noise2D = createNoise2D(prng);

        const voxels: StoredVoxel[] = [];
        for (let iX = 0; iX < this.size.x; iX++) {
            for (let iZ = 0; iZ < this.size.z; iZ++) {
                const yNoise = this.sampleHeightmapInternal(iX, iZ).altitude;

                const type = this.altitudeToVoxelType(yNoise);
                const iY = Math.floor(yNoise);
                const id = this.buildId(iX, iZ);
                voxels[id] = {
                    y: iY,
                    type,
                };
            }
        }
        this.voxels = voxels;

        const centerMap = true;
        if (centerMap) {
            this.coordsShift = this.size.clone().multiplyScalar(-0.5).floor();
        }

        console.log(`Generated map of size ${this.size.x}x${this.size.y}x${this.size.z} (${this.voxels.length.toLocaleString()} voxels)`);
    }

    public getLocalMapData(blockStart: THREE.Vector3, blockEnd: THREE.Vector3): ILocalMapData | Promise<ILocalMapData> {
        const blockSize = new THREE.Vector3().subVectors(blockEnd, blockStart);
        const cache = new Uint16Array(blockSize.x * blockSize.y * blockSize.z);

        const indexFactor = { x: 1, y: blockSize.x, z: blockSize.x * blockSize.y };

        const buildIndex = (position: THREE.Vector3) => {
            if (position.x < 0 || position.y < 0 || position.z < 0) {
                throw new Error();
            }
            return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
        };

        let isEmpty = true;
        for (const voxel of this.iterateOnVoxels(blockStart, blockEnd)) {
            const localPosition = new THREE.Vector3().subVectors(voxel.position, blockStart);
            const cacheIndex = buildIndex(localPosition);
            cache[cacheIndex] = 1 + voxel.materialId;
            isEmpty = false;
        }

        const result = {
            data: cache,
            isEmpty,
        };

        const synchronous = false;
        if (synchronous) {
            return result;
        } else {
            return Promise.resolve(result);
        }
    }

    public sampleHeightmap(coords: IHeightmapCoords[]): IHeightmapSample[] | Promise<IHeightmapSample[]> {
        const result = coords.map(coords => this.sampleHeightmapInternal(coords.x, coords.z));

        const synchronous = false;
        if (synchronous) {
            return result;
        } else {
            return new Promise(resolve => {
                // setTimeout(() => {
                resolve(result);
                // }, Math.random() * 5000);
            });
        }
    }

    private sampleHeightmapInternal(x: number, z: number): IHeightmapSample {
        x -= this.coordsShift.x;
        z -= this.coordsShift.z;

        const noise = this.noise2D(x / 50, z / 50);
        const altitude = (0.5 + 0.5 * noise) * this.size.y;

        const voxelType = this.altitudeToVoxelType(altitude);
        const material = this.voxelMaterialsList[voxelType]!;
        return {
            altitude,
            color: material.color,
        };
    }

    private altitudeToVoxelType(y: number): EVoxelType {
        if (y < 0.1 * this.size.y) {
            return EVoxelType.WATER;
        } else if (y < 0.3 * this.size.y) {
            return EVoxelType.SAND;
        } else if (y < 0.75 * this.size.y) {
            return EVoxelType.GRASS;
        } else if (y < 0.85 * this.size.y) {
            return EVoxelType.ROCK;
        } else {
            return EVoxelType.SNOW;
        }
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
