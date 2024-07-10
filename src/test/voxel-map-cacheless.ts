import alea from 'alea';
import { type NoiseFunction2D, createNoise2D } from 'simplex-noise';
import * as THREE from 'three';

import {
    type IHeightmap,
    type IHeightmapCoords,
    type IHeightmapSample,
    type ILocalMapData,
    type IVoxelMap,
    type IVoxelMaterial,
} from '../lib/index';

enum EVoxelType {
    ROCK,
    GRASS,
    SNOW,
    WATER,
    SAND,
}

const voxelMaterials: Record<EVoxelType, IVoxelMaterial> = [
    { color: new THREE.Color('#ABABAB') },
    { color: new THREE.Color('#00B920') },
    { color: new THREE.Color('#E5E5E5') },
    { color: new THREE.Color('#0055E2') },
    { color: new THREE.Color('#DCBE28') },
];

class VoxelMapCacheless implements IVoxelMap, IHeightmap {
    public readonly scaleXZ: number;
    public readonly scaleY: number;
    public readonly voxelMaterialsList = Object.values(voxelMaterials);

    public readonly minAltitude: number = -1;
    public readonly maxAltitude: number;

    private readonly noise2D: NoiseFunction2D;
    private readonly coordsShift: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    public constructor(scaleXZ: number, altitude: number, seed: string) {
        this.scaleXZ = scaleXZ;
        this.scaleY = altitude;
        this.maxAltitude = altitude + 1;

        const prng = alea(seed);
        this.noise2D = createNoise2D(prng);

        const centerMap = true;
        if (centerMap) {
            this.coordsShift = new THREE.Vector3(2048, altitude, 2048).multiplyScalar(-0.5).floor();
        }
    }

    public getLocalMapData(blockStart: THREE.Vector3, blockEnd: THREE.Vector3): ILocalMapData | Promise<ILocalMapData> {
        const blockSize = new THREE.Vector3().subVectors(blockEnd, blockStart);
        const data = new Uint16Array(blockSize.x * blockSize.y * blockSize.z);

        const indexFactor = { x: 1, y: blockSize.x, z: blockSize.x * blockSize.y };

        const buildIndex = (position: THREE.Vector3Like) => {
            if (position.x < 0 || position.y < 0 || position.z < 0) {
                throw new Error();
            }
            return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
        };

        let isEmpty = true;
        const pos = { x: 0, y: 0, z: 0 };
        for (pos.z = blockStart.z; pos.z < blockEnd.z; pos.z++) {
            for (pos.x = blockStart.x; pos.x < blockEnd.x; pos.x++) {
                const sample = this.sampleHeightmapInternal(pos.x, pos.z);
                if (blockStart.y <= sample.altitude && sample.altitude < blockEnd.y) {
                    pos.y = sample.altitude;
                    const voxelType = this.altitudeToVoxelType(sample.altitude);
                    // for (pos.y = blockStart.y; pos.y < blockEnd.y; pos.y++) {
                    // if (pos.y <= sample.altitude) {
                    const localPos = new THREE.Vector3().subVectors(pos, blockStart);
                    const index = buildIndex(localPos);
                    data[index] = voxelType + 1;
                    isEmpty = false;
                    // }
                }
            }
        }

        const result = {
            data,
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

        const synchronous = true;
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

        const noise = this.noise2D(x / this.scaleXZ, z / this.scaleXZ);
        const altitude = Math.floor((0.5 + 0.5 * noise) * this.scaleY);

        const voxelType = this.altitudeToVoxelType(altitude);
        const material = this.voxelMaterialsList[voxelType]!;
        return {
            altitude,
            color: material.color,
        };
    }

    private altitudeToVoxelType(y: number): EVoxelType {
        if (y < 0.1 * this.scaleY) {
            return EVoxelType.WATER;
        } else if (y < 0.3 * this.scaleY) {
            return EVoxelType.SAND;
        } else if (y < 0.75 * this.scaleY) {
            return EVoxelType.GRASS;
        } else if (y < 0.85 * this.scaleY) {
            return EVoxelType.ROCK;
        } else {
            return EVoxelType.SNOW;
        }
    }
}

export { VoxelMapCacheless };
