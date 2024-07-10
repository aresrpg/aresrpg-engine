import alea from 'alea';
import { type NoiseFunction2D, createNoise2D } from 'simplex-noise';
import * as THREE from 'three';

import {
    type IHeightmap,
    type IHeightmapCoords,
    type IHeightmapSample,
    type ILocalMapData,
    type IVoxelMap
} from '../../lib/index';
import { EVoxelType, voxelMaterials } from './materials';
import { TreeRepartition } from './trees/repartition';
import { Tree } from './trees/tree';


class VoxelMapCacheless implements IVoxelMap, IHeightmap {
    public readonly scaleXZ: number;
    public readonly scaleY: number;
    public readonly voxelMaterialsList = Object.values(voxelMaterials);

    public readonly minAltitude: number = -1;
    public readonly maxAltitude: number;

    private readonly noise2D: NoiseFunction2D;
    private readonly coordsShift: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    private readonly tree = new Tree();
    private readonly treesDensityNoise: NoiseFunction2D;
    private readonly treesDensityFrequency = 0.002
    private readonly treesRepartition = new TreeRepartition(200, 2 * this.tree.radiusXZ);

    private thresholdWater: number;
    private thresholdSand: number;
    private thresholdGrass: number;
    private thresholdRock: number;

    public constructor(scaleXZ: number, altitude: number, seed: string) {
        this.scaleXZ = scaleXZ;
        this.scaleY = altitude;
        this.maxAltitude = altitude + 1;

        this.thresholdWater = 0.1 * this.scaleY;
        this.thresholdSand = 0.3 * this.scaleY;
        this.thresholdGrass = 0.75 * this.scaleY;
        this.thresholdRock = 0.85 * this.scaleY;

        const prng = alea(seed);
        this.noise2D = createNoise2D(prng);
        this.treesDensityNoise = createNoise2D(prng);

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
        const setVoxel = (localPos: THREE.Vector3Like, voxelType: EVoxelType) => {
            const index = buildIndex(localPos);
            data[index] = voxelType + 1;
            isEmpty = false;
        };

        const addTree = (worldBasePos: THREE.Vector3Like, tree: Tree) => {
            const treeWorldBasePos = {
                x: worldBasePos.x + tree.offset.x,
                y: worldBasePos.y + tree.offset.y,
                z: worldBasePos.z + tree.offset.z,
            };
            const worldPosFrom = new THREE.Vector3().copy(treeWorldBasePos);
            const worldPosTo = new THREE.Vector3().addVectors(treeWorldBasePos, tree.size);
            worldPosFrom.max(blockStart);
            worldPosTo.min(blockEnd);

            const blockLocalPos = new THREE.Vector3();
            const treeLocalPos = new THREE.Vector3();
            const worldPos = new THREE.Vector3();
            for (worldPos.z = worldPosFrom.z; worldPos.z < worldPosTo.z; worldPos.z++) {
                for (worldPos.y = worldPosFrom.y; worldPos.y < worldPosTo.y; worldPos.y++) {
                    for (worldPos.x = worldPosFrom.x; worldPos.x < worldPosTo.x; worldPos.x++) {
                        treeLocalPos.subVectors(worldPos, treeWorldBasePos);
                        const treeVoxel = tree.getVoxel(treeLocalPos);
                        if (treeVoxel !== null) {
                            blockLocalPos.subVectors(worldPos, blockStart);
                            setVoxel(blockLocalPos, treeVoxel);
                        }
                    }
                }
            }
        };

        // first, fill base terrain
        const localPos = new THREE.Vector3();
        const worldPos = { x: 0, y: 0, z: 0 };
        for (worldPos.z = blockStart.z; worldPos.z < blockEnd.z; worldPos.z++) {
            for (worldPos.x = blockStart.x; worldPos.x < blockEnd.x; worldPos.x++) {
                const sample = this.sampleHeightmapBaseTerrain(worldPos.x, worldPos.z);
                if (blockStart.y <= sample.altitude && sample.altitude < blockEnd.y) {
                    worldPos.y = sample.altitude;
                    const voxelType = this.altitudeToVoxelType(sample.altitude);
                    localPos.subVectors(worldPos, blockStart);
                    setVoxel(localPos, voxelType);
                }
            }
        }

        // then, add trees
        for (const treeWorldPosition of this.getAllTreesForBlock({ x: blockStart.x, y: blockStart.z }, { x: blockEnd.x, y: blockEnd.z })) {
            addTree(treeWorldPosition, this.tree);
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
        const result = coords.map(coords => {
            let sample = this.sampleHeightmapBaseTerrain(coords.x, coords.z);

            for (let treeWorldPosition of this.getAllTreesForBlock({ x: coords.x, y: coords.z }, { x: coords.x, y: coords.z })) {
                const treeWorldBasePos = {
                    x: treeWorldPosition.x + this.tree.offset.x,
                    y: treeWorldPosition.y + this.tree.offset.y,
                    z: treeWorldPosition.z + this.tree.offset.z,
                };
                const treeLocalPosition = {
                    x: coords.x - treeWorldBasePos.x,
                    y: coords.z - treeWorldBasePos.z,
                };

                const treeSample = this.tree.getHeightmapSample(treeLocalPosition);
                if (treeSample) {
                    const treeSampleAltitude = treeWorldBasePos.y + treeSample.altitude;
                    if (sample.altitude < treeSampleAltitude) {
                        sample = {
                            color: treeSample.color,
                            altitude: treeSampleAltitude,
                        };
                    }
                }
            }

            return sample;
        });

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

    private sampleHeightmapBaseTerrain(x: number, z: number): IHeightmapSample {
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
        if (y < this.thresholdWater) {
            return EVoxelType.WATER;
        } else if (y < this.thresholdSand) {
            return EVoxelType.SAND;
        } else if (y < this.thresholdGrass) {
            return EVoxelType.GRASS;
        } else if (y < this.thresholdRock) {
            return EVoxelType.ROCK;
        } else {
            return EVoxelType.SNOW;
        }
    }

    private *getAllTreesForBlock(blockStart: THREE.Vector2Like, blockEnd: THREE.Vector2Like): Generator<THREE.Vector3Like> {
        // then, add trees
        const treeSearchFrom = { x: blockStart.x - this.tree.radiusXZ, y: blockStart.y - this.tree.radiusXZ };
        const treeSearchTo = { x: blockEnd.x + this.tree.radiusXZ, y: blockEnd.y + this.tree.radiusXZ };
        for (const tree of this.treesRepartition.getAllTrees(treeSearchFrom, treeSearchTo)) {
            const worldPos = { x: tree.position.x, y: 0, z: tree.position.y };

            const sample = this.sampleHeightmapBaseTerrain(worldPos.x, worldPos.z);
            let localTreeDensity = 0.5 + 0.5 * this.treesDensityNoise(worldPos.x * this.treesDensityFrequency, worldPos.z * this.treesDensityFrequency);
            if (sample.altitude < this.thresholdWater) {
                localTreeDensity -= 1;
            } else if (sample.altitude < this.thresholdSand) {
                const distanceToWater = (sample.altitude - this.thresholdWater) / (this.thresholdSand - this.thresholdWater);
                if (distanceToWater < 0.1) {
                    localTreeDensity += 0.25;
                } else {
                    localTreeDensity -= Math.pow(1 - distanceToWater, 0.5);
                }
            } else if (sample.altitude < this.thresholdGrass) {
                localTreeDensity -= 0;
            } else if (sample.altitude < this.thresholdRock) {
                localTreeDensity -= 0.75;
            } else {
                localTreeDensity -= 1;
            }

            if (tree.probability > 1 - localTreeDensity) {
                worldPos.y = sample.altitude;
                yield worldPos;
            }
        }
    }
}

export { VoxelMapCacheless };
