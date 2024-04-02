import { logger } from '../helpers/logger';
import * as THREE from '../three-usage';

import { AsyncPatch } from './async-patch';
import { IVoxelMap } from './i-voxel-map';
import { EDisplayMode } from './patch/patch';
import { EPatchComputingMode, PatchFactoryBase } from './patch/patch-factory/patch-factory-base';
import { PatchFactoryCpu } from './patch/patch-factory/split/cpu/patch-factory-cpu';
import { PatchFactoryGpuOptimized } from './patch/patch-factory/split/gpu/patch-factory-gpu-optimized';
import { PatchFactoryGpuSequential } from './patch/patch-factory/split/gpu/patch-factory-gpu-sequential';

type TerrainOptions = {
    computingMode?: EPatchComputingMode;
};

/**
 * Class that takes an IVoxelMap and makes a renderable three.js object of it.
 */
class Terrain {
    /**
     * The three.js object containing the renderable map.
     */
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        shadows: {
            cast: true,
            receive: true,
        },
        voxels: {
            displayMode: EDisplayMode.TEXTURES,
            noiseStrength: 0.025,
        },
        smoothEdges: {
            enabled: true,
            radius: 0.1,
            quality: 2,
        },
        ao: {
            enabled: true,
            strength: 0.4,
            spread: 0.85,
        },
    };

    private maxPatchesInCache = 200;

    private readonly patchFactory: PatchFactoryBase;
    private readonly patchSize: THREE.Vector3;

    private readonly patches: Record<string, AsyncPatch> = {};

    /**
     *
     * @param map The map that will be rendered.
     */
    public constructor(map: IVoxelMap, options?: TerrainOptions) {
        let computingMode = EPatchComputingMode.GPU_OPTIMIZED;
        if (options) {
            if (typeof options.computingMode !== 'undefined') {
                computingMode = options.computingMode;
            }
        }

        if (computingMode === EPatchComputingMode.CPU_SIMPLE || computingMode === EPatchComputingMode.CPU_CACHED) {
            this.patchFactory = new PatchFactoryCpu(map, computingMode);
        } else if (computingMode === EPatchComputingMode.GPU_SEQUENTIAL) {
            this.patchFactory = new PatchFactoryGpuSequential(map);
        } else if (computingMode === EPatchComputingMode.GPU_OPTIMIZED) {
            this.patchFactory = new PatchFactoryGpuOptimized(map);
        } else {
            throw new Error(`Unsupported computing mode "${computingMode}".`);
        }

        this.patchSize = this.patchFactory.maxPatchSize.clone();
        logger.info(`Using max patch size ${this.patchSize.x}x${this.patchSize.y}x${this.patchSize.z}.`);

        this.container = new THREE.Group();
    }

    /**
     * Makes the portion of the map within a box visible.
     */
    public async showMapPortion(box: THREE.Box3): Promise<void> {
        const voxelFrom = box.min;
        const voxelTo = box.max;
        const patchIdFrom = voxelFrom.divide(this.patchSize).floor();
        const patchIdTo = voxelTo.divide(this.patchSize).ceil();

        const promises: Promise<void>[] = [];

        const patchId = new THREE.Vector3();
        const patchStart = new THREE.Vector3();
        for (patchId.x = patchIdFrom.x; patchId.x < patchIdTo.x; patchId.x++) {
            for (patchId.y = patchIdFrom.y; patchId.y < patchIdTo.y; patchId.y++) {
                for (patchId.z = patchIdFrom.z; patchId.z < patchIdTo.z; patchId.z++) {
                    patchStart.multiplyVectors(patchId, this.patchSize);
                    const patch = this.getPatch(patchStart);
                    patch.visible = true;
                    promises.push(patch.ready());
                }
            }
        }

        await Promise.all(promises);
    }

    /**
     * Only makes visible the portion of the map that is around a given position.
     * @param position The position around which the map will be made visible.
     * @param radius The visibility radius, in voxels.
     */
    public async showMapAroundPosition(position: THREE.Vector3, radius: number): Promise<void> {
        const voxelFrom = new THREE.Vector3().copy(position).subScalar(radius);
        const voxelTo = new THREE.Vector3().copy(position).addScalar(radius);
        const patchIdFrom = voxelFrom.divide(this.patchSize).floor();
        const patchIdTo = voxelTo.divide(this.patchSize).ceil();

        for (const patch of Object.values(this.patches)) {
            patch.visible = false;
        }

        const visibilitySphere = new THREE.Sphere(position, radius);
        const promises: Promise<void>[] = [];
        const patchId = new THREE.Vector3();
        for (patchId.x = patchIdFrom.x; patchId.x < patchIdTo.x; patchId.x++) {
            for (patchId.y = patchIdFrom.y; patchId.y < patchIdTo.y; patchId.y++) {
                for (patchId.z = patchIdFrom.z; patchId.z < patchIdTo.z; patchId.z++) {
                    const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);

                    const boundingBox = new THREE.Box3(patchStart, patchStart.clone().add(this.patchSize));
                    if (visibilitySphere.intersectsBox(boundingBox)) {
                        const patch = this.getPatch(patchStart);
                        patch.visible = true;
                        promises.push(patch.ready());
                    }
                }
            }
        }

        this.garbageCollectPatches();

        await Promise.all(promises);
    }

    /**
     * Call this method before rendering.
     * */
    public updateUniforms(): void {
        for (const asyncPatch of Object.values(this.patches)) {
            const patch = asyncPatch.patch;
            if (patch) {
                patch.parameters.voxels.displayMode = this.parameters.voxels.displayMode;
                patch.parameters.voxels.noiseStrength = this.parameters.voxels.noiseStrength;

                patch.parameters.smoothEdges.enabled = this.parameters.smoothEdges.enabled;
                patch.parameters.smoothEdges.radius = this.parameters.smoothEdges.radius;
                patch.parameters.smoothEdges.quality = this.parameters.smoothEdges.quality;

                patch.parameters.ao.enabled = this.parameters.ao.enabled;
                patch.parameters.ao.strength = this.parameters.ao.strength;
                patch.parameters.ao.spread = this.parameters.ao.spread;

                patch.parameters.shadows = this.parameters.shadows;

                patch.updateUniforms();
            }
        }
    }

    /**
     * Deletes all the geometry data stored on the GPU.
     * It will be recomputed if needed again.
     */
    public clear(): void {
        for (const patchId of Object.keys(this.patches)) {
            this.disposePatch(patchId);
        }
        this.container.clear();
    }

    /**
     * Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
     */
    public dispose(): void {
        this.clear();
        this.patchFactory.dispose();
    }

    /**
     * Gets the maximum size of the GPU LRU cache of invisible patches.
     */
    public get patchesCacheSize(): number {
        return this.maxPatchesInCache;
    }

    /**
     * Sets the maximum size of the GPU LRU cache of invisible patches.
     */
    public set patchesCacheSize(value: number) {
        if (value <= 0) {
            throw new Error(`Invalid patches cache size "${value}".`);
        }
        this.maxPatchesInCache = value;
        this.garbageCollectPatches();
    }

    private garbageCollectPatches(): void {
        const patches = Object.entries(this.patches);
        const invisiblePatches = patches.filter(([, patch]) => !patch.visible);
        invisiblePatches.sort(([, patch1], [, patch2]) => patch1.invisibleSince - patch2.invisibleSince);

        while (invisiblePatches.length > this.maxPatchesInCache) {
            const nextPatchToDelete = invisiblePatches.shift();
            if (!nextPatchToDelete) {
                break;
            }
            this.disposePatch(nextPatchToDelete[0]);
        }
    }

    private disposePatch(patchId: string): void {
        const patch = this.patches[patchId];
        if (patch) {
            patch.dispose();
            delete this.patches[patchId];
        } else {
            logger.warn(`Patch ${patchId} does not exist.`);
        }
    }

    private getPatch(patchStart: THREE.Vector3): AsyncPatch {
        const patchId = this.computePatchId(patchStart);

        let patch = this.patches[patchId];
        if (typeof patch === 'undefined') {
            const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);

            const boundingBox = new THREE.Box3(patchStart.clone(), patchEnd.clone());
            const promise = this.patchFactory.buildPatch(patchStart, patchEnd);
            patch = new AsyncPatch(this.container, promise, patchId, boundingBox);

            this.patches[patchId] = patch;
        }
        return patch;
    }

    private computePatchId(patchStart: THREE.Vector3): string {
        return `${patchStart.x / this.patchSize.x}_${patchStart.y / this.patchSize.y}_${patchStart.z / this.patchSize.z}`;
    }
}

export { EPatchComputingMode, Terrain, type IVoxelMap };
