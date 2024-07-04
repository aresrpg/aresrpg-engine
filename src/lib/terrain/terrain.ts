import { DisposableMap } from '../helpers/disposable-map';
import { logger } from '../helpers/logger';
import { vec3ToString } from '../helpers/string';
import * as THREE from '../three-usage';

import { AsyncPatch } from './async-patch';
import { type IHeightmap } from './heightmap/i-heightmap';
import { TerrainBase, type ComputedPatch, type PatchRenderable } from './terrain-base';
import { type IVoxelMap } from './voxelmap/i-voxelmap';
import { PatchFactoryCpu } from './voxelmap/patch/patch-factory/merged/patch-factory-cpu';
import { PatchFactoryGpuOptimized } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-optimized';
import { PatchFactoryGpuSequential } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from './voxelmap/patch/patch-factory/patch-factory-base';
import { PatchId } from './voxelmap/patch/patch-id';
import { VoxelmapVisibilityComputer } from './voxelmap/voxelmap-visibility-computer';
import { type VoxelsChunkSize } from './voxelmap/voxelsRenderable/voxelsRenderableFactory/merged/vertex-data1-encoder';

type TerrainOptions = {
    computingMode?: EPatchComputingMode;
    patchSize?: VoxelsChunkSize;
};

enum EPatchComputingMode {
    CPU_CACHED,
    GPU_SEQUENTIAL,
    GPU_OPTIMIZED,
}

/**
 * Class that takes an IVoxelMap and makes a renderable three.js object of it.
 */
class Terrain extends TerrainBase {
    private readonly map: IVoxelMap;
    private readonly patchFactory: PatchFactoryBase;

    private readonly patchesStore = new DisposableMap<AsyncPatch>();

    protected readonly patchesVisibilityComputer: VoxelmapVisibilityComputer;

    /**
     *
     * @param map The map that will be rendered.
     */
    public constructor(map: IVoxelMap & IHeightmap, options?: TerrainOptions) {
        const voxelsChunksSize = options?.patchSize || { xz: 64, y: 64 };
        let computingMode = EPatchComputingMode.GPU_SEQUENTIAL;
        if (options) {
            if (typeof options.computingMode !== 'undefined') {
                computingMode = options.computingMode;
            }
        }

        let patchFactory: PatchFactoryBase;
        if (computingMode === EPatchComputingMode.CPU_CACHED) {
            patchFactory = new PatchFactoryCpu(map.voxelMaterialsList, voxelsChunksSize);
        } else if (computingMode === EPatchComputingMode.GPU_SEQUENTIAL) {
            patchFactory = new PatchFactoryGpuSequential(map.voxelMaterialsList, voxelsChunksSize);
        } else if (computingMode === EPatchComputingMode.GPU_OPTIMIZED) {
            patchFactory = new PatchFactoryGpuOptimized(map.voxelMaterialsList, voxelsChunksSize);
        } else {
            throw new Error(`Unsupported computing mode "${computingMode}".`);
        }
        const patchSize = patchFactory.maxPatchSize.clone();
        logger.info(`Using max patch size ${vec3ToString(patchSize)}.`);

        super(map, voxelsChunksSize);

        this.map = map;

        this.patchFactory = patchFactory;
        const minPatchIdY = Math.floor(map.minAltitude / this.patchSize.y);
        const maxPatchIdY = Math.floor(map.maxAltitude / this.patchSize.y);
        this.patchesVisibilityComputer = new VoxelmapVisibilityComputer(patchSize, minPatchIdY, maxPatchIdY);
    }

    /**
     * Makes the portion of the map within a box visible.
     */
    public async showMapPortion(box: THREE.Box3): Promise<void> {
        this.patchesVisibilityComputer.reset();
        this.patchesVisibilityComputer.showMapPortion(box);
        const requestedPatches = this.patchesVisibilityComputer.getRequestedPatches();

        const patchStart = new THREE.Vector3();
        const promises = requestedPatches.map(requestedPatch => {
            patchStart.multiplyVectors(requestedPatch.id, this.patchSize);
            const patch = this.getPatch(patchStart);
            patch.visible = true;
            return patch.ready();
        });

        await Promise.all(promises);
    }

    /**
     * Only makes visible the portion of the map that is around a given position.
     * @param position The position around which the map will be made visible.
     * @param radius The visibility radius, in voxels.
     */
    public async showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): Promise<void> {
        for (const patch of this.patchesStore.allItems) {
            patch.visible = false;
        }

        this.patchesVisibilityComputer.reset();
        this.patchesVisibilityComputer.showMapAroundPosition(position, radius, frustum);
        const requestedPatches = this.patchesVisibilityComputer.getRequestedPatches();

        const patchStart = new THREE.Vector3();
        const promises = requestedPatches.map(requestedPatch => {
            patchStart.multiplyVectors(requestedPatch.id, this.patchSize);
            const patch = this.getPatch(patchStart);
            patch.visible = true;
            return patch.ready();
        });

        this.heightmapViewerNeedsUpdate = true;

        await Promise.all(promises);
    }

    /**
     * Deletes all the geometry data stored on the GPU.
     * It will be recomputed if needed again.
     */
    public clear(): void {
        this.patchesStore.clear();
        this.patchesContainer.clear();
    }

    /**
     * Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
     */
    public override dispose(): void {
        super.dispose();
        this.clear();
        this.patchFactory.dispose();
    }

    protected override get allLoadedPatches(): ComputedPatch[] {
        const result: ComputedPatch[] = [];
        for (const patch of this.patchesStore.allItems) {
            if (patch.renderable) {
                result.push({
                    isVisible: patch.visible,
                    voxelsRenderable: patch.renderable,
                });
            }
        }
        return result;
    }

    protected override get allVisiblePatches(): PatchRenderable[] {
        const patches: PatchRenderable[] = [];
        for (const asyncPatch of this.patchesStore.allItems) {
            const voxelsRenderable = asyncPatch.renderable;
            if (voxelsRenderable) {
                const isVisible = !!asyncPatch && asyncPatch.visible && asyncPatch.isReady;
                if (isVisible) {
                    patches.push({
                        id: asyncPatch.id,
                        voxelsRenderable,
                    });
                }
            }
        }
        return patches;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const patch = this.patchesStore.getItem(patchId.asString);
        return !!patch && patch.visible && patch.isReady;
    }

    protected override garbageCollectPatches(maxInvisiblePatchesInPatch: number): void {
        const patches = this.patchesStore.allItems;
        const invisiblePatches = patches.filter(patch => !patch.visible);
        invisiblePatches.sort((patch1, patch2) => patch1.invisibleSince - patch2.invisibleSince);

        while (invisiblePatches.length > maxInvisiblePatchesInPatch) {
            const nextPatchToDelete = invisiblePatches.shift();
            if (!nextPatchToDelete) {
                break;
            }
            this.disposePatch(nextPatchToDelete.id.asString);
        }
    }

    private disposePatch(patchId: string): void {
        const patchExisted = this.patchesStore.deleteItem(patchId);
        if (patchExisted) {
            logger.diagnostic(`Freeing voxels patch ${patchId}`);
        } else {
            logger.warn(`Voxels patch ${patchId} does not exist.`);
        }
    }

    private getPatch(patchStart: THREE.Vector3): AsyncPatch {
        const patchId = this.computePatchId(patchStart);

        let patch = this.patchesStore.getItem(patchId.asString);
        if (!patch) {
            const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);

            const promise = this.patchFactory.buildPatch(patchId, patchStart, patchEnd, this.map);
            patch = new AsyncPatch(this.patchesContainer, promise, patchId);
            patch.ready().then(() => {
                if (patch?.hasVisibleMesh) {
                    this.heightmapViewerNeedsUpdate = true;
                }
            });
            this.patchesStore.setItem(patchId.asString, patch);

            logger.diagnostic(`Building voxels patch ${patchId.asString}`);
        }
        return patch;
    }

    private computePatchId(patchStart: THREE.Vector3): PatchId {
        return new PatchId(patchStart.clone().divide(this.patchSize));
    }
}

export { EPatchComputingMode, Terrain, type IVoxelMap, type TerrainOptions, type VoxelsChunkSize };
