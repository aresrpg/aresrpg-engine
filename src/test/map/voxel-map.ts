import alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import * as THREE from 'three';

import { safeModulo } from '../../lib/helpers/math';
import {
    voxelmapDataPacking,
    type IHeightmap,
    type IHeightmapCoords,
    type IHeightmapSample,
    type ILocalMapData,
    type IVoxelMap,
} from '../../lib/index';

import { colorMapping } from './color-mapping';
import { TreeRepartition } from './trees/repartition';
import { Tree } from './trees/tree';

type TreesTextureSample = {
    readonly heightmapSample: IHeightmapSample;
    readonly treeRootTextureCoords: THREE.Vector2Like;
    readonly treeProbability: number;
};

type TreesTexture = {
    readonly data: Array<TreesTextureSample | null>;
    readonly size: number;
    buildIndex(x: number, y: number): number;
};

const keyColors = {
    rock: { color: new THREE.Color('#ABABAB') },
    grass: { color: new THREE.Color('#00B920') },
    snow: { color: new THREE.Color('#E5E5E5') },
    water: { color: new THREE.Color('#0055E2') },
    sand: { color: new THREE.Color('#DCBE28') },
    treeTrunk: { color: new THREE.Color('#692D00') },
    treeLeaves: { color: new THREE.Color('#007A00') },
};

class VoxelMap implements IVoxelMap, IHeightmap {
    public readonly scaleXZ: number;
    public readonly scaleY: number;
    public readonly voxelMaterialsList = colorMapping.materialsList;

    public readonly minAltitude: number = -1;
    public readonly maxAltitude: number;

    private readonly noise2D: NoiseFunction2D;
    private readonly coordsShift: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

    private readonly tree = new Tree();
    private readonly treesDensityNoise: NoiseFunction2D;
    private readonly treesDensityFrequency = 0.002;
    private readonly treesRepartition = new TreeRepartition(150, 2 * this.tree.radiusXZ);
    private readonly treesTexture: TreesTexture;

    private readonly colorVariationNoise: NoiseFunction2D;

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
        this.colorVariationNoise = createNoise2D(prng);

        const centerMap = true;
        if (centerMap) {
            this.coordsShift = new THREE.Vector3(2048, altitude, 2048).multiplyScalar(-0.5).floor();
        }

        this.treesTexture = {
            data: [],
            size: this.treesRepartition.size,
            buildIndex(x: number, y: number): number {
                return x + y * this.size;
            },
        };
        for (let i = 0; i < this.treesTexture.size * this.treesTexture.size; i++) {
            this.treesTexture.data.push(null);
        }
        const treeSearchFrom = { x: -this.tree.radiusXZ, y: -this.tree.radiusXZ };
        const treeSearchTo = { x: this.treesTexture.size + this.tree.radiusXZ, y: this.treesTexture.size + this.tree.radiusXZ };
        for (const tree of this.treesRepartition.getAllTrees(treeSearchFrom, treeSearchTo)) {
            const treeRootTexturePos = {
                x: tree.position.x + this.tree.offset.x,
                y: tree.position.y + this.tree.offset.z,
            };
            const treeLocalPos = { x: 0, y: 0 };
            for (treeLocalPos.y = 0; treeLocalPos.y < this.tree.size.z; treeLocalPos.y++) {
                for (treeLocalPos.x = 0; treeLocalPos.x < this.tree.size.x; treeLocalPos.x++) {
                    const treeTexturePos = {
                        x: treeRootTexturePos.x + treeLocalPos.x,
                        y: treeRootTexturePos.y + treeLocalPos.y,
                    };
                    if (
                        treeTexturePos.x >= 0 &&
                        treeTexturePos.y >= 0 &&
                        treeTexturePos.x < this.treesTexture.size &&
                        treeTexturePos.y < this.treesTexture.size
                    ) {
                        const sample = this.tree.getHeightmapSample(treeLocalPos);
                        if (sample) {
                            const index = this.treesTexture.buildIndex(treeTexturePos.x, treeTexturePos.y);
                            if (this.treesTexture.data[index]) {
                                throw new Error('Trees cannot overlap');
                            }
                            this.treesTexture.data[index] = {
                                heightmapSample: sample,
                                treeRootTextureCoords: treeTexturePos,
                                treeProbability: tree.probability,
                            };
                        }
                    }
                }
            }
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
        const setVoxel = (localPos: THREE.Vector3Like, materialId: number) => {
            const index = buildIndex(localPos);
            data[index] = voxelmapDataPacking.encode(false, materialId);
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

        let isFullPatch = true;
        const samples: IHeightmapSample[] = [];
        for (worldPos.z = blockStart.z; worldPos.z < blockEnd.z; worldPos.z++) {
            for (worldPos.x = blockStart.x; worldPos.x < blockEnd.x; worldPos.x++) {
                const sample = this.sampleHeightmapBaseTerrain(worldPos.x, worldPos.z);
                samples.push(sample);
                if (sample.altitude <= blockEnd.y) {
                    isFullPatch = false;
                }
            }
        }

        if (!isFullPatch) {
            for (worldPos.z = blockStart.z; worldPos.z < blockEnd.z; worldPos.z++) {
                for (worldPos.x = blockStart.x; worldPos.x < blockEnd.x; worldPos.x++) {
                    localPos.subVectors(worldPos, blockStart);
                    const sample = samples[localPos.x + localPos.z * blockSize.x];
                    if (typeof sample === 'undefined') {
                        throw new Error();
                    }
                    const voxelColor = this.positionToColor(worldPos.x, sample.altitude, worldPos.z);
                    const materialId = colorMapping.getMaterialId(voxelColor);
                    const fromY = blockStart.y - blockStart.y;
                    const toY = Math.min(blockEnd.y, sample.altitude + 1) - blockStart.y;
                    for (localPos.y = fromY; localPos.y < toY; localPos.y++) {
                        setVoxel(localPos, materialId);
                    }
                }
            }

            // then, add trees
            for (const treeWorldPosition of this.getAllTreesForBlock(
                { x: blockStart.x, y: blockStart.z },
                { x: blockEnd.x, y: blockEnd.z }
            )) {
                addTree(treeWorldPosition, this.tree);
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
        const result = coords.map(coords => {
            let sample = this.sampleHeightmapBaseTerrain(coords.x, coords.z);

            const voxelsWorldCoords = {
                x: Math.floor(coords.x),
                z: Math.floor(coords.z),
            };
            const voxelTextureCoords = {
                x: safeModulo(voxelsWorldCoords.x, this.treesTexture.size),
                z: safeModulo(voxelsWorldCoords.z, this.treesTexture.size),
            };
            const textureBaseCoords = {
                x: this.treesTexture.size * Math.floor(voxelsWorldCoords.x / this.treesTexture.size),
                z: this.treesTexture.size * Math.floor(voxelsWorldCoords.z / this.treesTexture.size),
            };

            const treesTextureSample = this.treesTexture.data[this.treesTexture.buildIndex(voxelTextureCoords.x, voxelTextureCoords.z)];
            if (typeof treesTextureSample === 'undefined') {
                throw new Error();
            }
            if (treesTextureSample) {
                const treeRootWorldCoords = {
                    x: textureBaseCoords.x + treesTextureSample.treeRootTextureCoords.x,
                    y: 0,
                    z: textureBaseCoords.z + treesTextureSample.treeRootTextureCoords.y,
                };
                treeRootWorldCoords.y = this.sampleHeightmapBaseTerrain(treeRootWorldCoords.x, treeRootWorldCoords.z).altitude;

                const treeSampleAltitude = treeRootWorldCoords.y + treesTextureSample.heightmapSample.altitude;
                if (sample.altitude < treeSampleAltitude) {
                    if (this.isThereATree(treeRootWorldCoords, treesTextureSample.treeProbability)) {
                        sample = {
                            color: treesTextureSample.heightmapSample.color,
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

    public sampleHeightmapBaseTerrain(x: number, z: number): IHeightmapSample {
        x -= this.coordsShift.x;
        z -= this.coordsShift.z;

        const noise = this.noise2D(x / this.scaleXZ, z / this.scaleXZ);
        let altitude = (0.5 + 0.5 * noise) * this.scaleY;
        if (altitude >= this.thresholdGrass) {
            const margin = this.maxAltitude - 1 - this.thresholdGrass;
            const distanceToRock = altitude - this.thresholdGrass;
            const relativeDistance = distanceToRock / margin;
            altitude = this.thresholdGrass + Math.pow(relativeDistance, 0.25) * margin;
        }
        altitude = Math.floor(altitude);

        const color = this.positionToColor(x, altitude, z);
        return {
            altitude,
            color,
        };
    }

    private positionToColor(x: number, y: number, z: number): THREE.Color {
        const computeGrassColor = () => {
            const frequency = 1 / 100;
            const noise = this.colorVariationNoise(x * frequency, z * frequency);
            return new THREE.Color().copy(keyColors.grass.color).multiplyScalar(1 + 0.3 * noise);
        };

        const computeRockThreshold = () => {
            const frequency = 1 / 10;
            const noise = this.colorVariationNoise(x * frequency, z * frequency);
            return this.thresholdRock + 0.02 * noise * this.scaleY;
        };

        if (y < this.thresholdWater) {
            return keyColors.water.color;
        } else if (y < this.thresholdSand) {
            const pureSandLimit = this.thresholdWater + 0.3 * (this.thresholdSand - this.thresholdWater);
            if (y < pureSandLimit) {
                return keyColors.sand.color;
            } else {
                const grassColor = computeGrassColor();
                const closeToGrass = (0.5 * (y - pureSandLimit)) / (this.thresholdSand - pureSandLimit);
                return new THREE.Color().lerpColors(keyColors.sand.color, grassColor, closeToGrass);
            }
        } else if (y < this.thresholdGrass) {
            const grassColor = computeGrassColor();
            const mergeFactor = 0.2;
            const pureGrassLimit = this.thresholdSand + mergeFactor * (this.thresholdGrass - this.thresholdSand);
            if (y < pureGrassLimit) {
                const closeToSand = (0.5 * (pureGrassLimit - y)) / (pureGrassLimit - this.thresholdSand);
                return new THREE.Color().lerpColors(grassColor, keyColors.sand.color, closeToSand);
            } else {
                return grassColor;
            }
        } else if (y < computeRockThreshold()) {
            return keyColors.rock.color;
        } else {
            return keyColors.snow.color;
        }
    }

    private getAllTreesForBlock(blockStart: THREE.Vector2Like, blockEnd: THREE.Vector2Like): THREE.Vector3Like[] {
        const result: THREE.Vector3Like[] = [];

        const treeSearchFrom = { x: blockStart.x - this.tree.radiusXZ, y: blockStart.y - this.tree.radiusXZ };
        const treeSearchTo = { x: blockEnd.x + this.tree.radiusXZ, y: blockEnd.y + this.tree.radiusXZ };
        for (const tree of this.treesRepartition.getAllTrees(treeSearchFrom, treeSearchTo)) {
            const worldPos = { x: tree.position.x, y: 0, z: tree.position.y };
            const sample = this.sampleHeightmapBaseTerrain(worldPos.x, worldPos.z);
            worldPos.y = sample.altitude;

            if (this.isThereATree(worldPos, tree.probability)) {
                result.push(worldPos);
            }
        }

        return result;
    }

    private isThereATree(worldPos: THREE.Vector3Like, treeProbability: number): boolean {
        let localTreeDensity =
            0.5 + 0.5 * this.treesDensityNoise(worldPos.x * this.treesDensityFrequency, worldPos.z * this.treesDensityFrequency);
        if (worldPos.y < this.thresholdWater) {
            localTreeDensity -= 1;
        } else if (worldPos.y < this.thresholdSand) {
            const distanceToWater = (worldPos.y - this.thresholdWater) / (this.thresholdSand - this.thresholdWater);
            if (distanceToWater < 0.1) {
                localTreeDensity += 0.25;
            } else {
                localTreeDensity -= Math.pow(1 - distanceToWater, 0.5);
            }
        } else if (worldPos.y < this.thresholdGrass) {
            localTreeDensity -= 0;
        } else {
            localTreeDensity -= 1;
        }
        return treeProbability > 1 - localTreeDensity;
    }
}

export { VoxelMap };
