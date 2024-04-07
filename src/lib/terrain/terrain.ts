import { logger } from '../helpers/logger';
import * as THREE from '../three-usage';

import { AsyncPatch } from './async-patch';
import { HeightmapViewer } from "./heightmap/heightmap-viewer";
import { type IVoxelMap } from './i-voxel-map';
import { EDisplayMode } from './patch/patch';
import { EPatchComputingMode, PatchFactoryBase } from './patch/patch-factory/patch-factory-base';
import { PatchFactoryCpu } from './patch/patch-factory/split/cpu/patch-factory-cpu';
import { PatchFactoryGpuOptimized } from './patch/patch-factory/split/gpu/patch-factory-gpu-optimized';
import { PatchFactoryGpuSequential } from './patch/patch-factory/split/gpu/patch-factory-gpu-sequential';
import { PatchId } from './patch/patch-id';

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
            faces: {
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
        },
        lod: {
            enabled: true,
        },
    };

    private readonly patchesContainer: THREE.Group;
    private readonly heightmapContainer: THREE.Group;

    private maxPatchesInCache = 200;

    private readonly patchFactory: PatchFactoryBase;
    private readonly patchSize: THREE.Vector3;

    private readonly patches: Record<string, AsyncPatch> = {};

    private readonly heightmapViewer: HeightmapViewer;
    private heightmapViewerNeedsUpdate: boolean = true;

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

        if (computingMode === EPatchComputingMode.CPU_CACHED) {
            this.patchFactory = new PatchFactoryCpu(map);
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
        this.container.name = 'Terrain container';

        this.patchesContainer = new THREE.Group();
        this.patchesContainer.name = 'Voxel patches container';
        this.container.add(this.patchesContainer);

        this.heightmapContainer = new THREE.Group();
        this.heightmapContainer.name = `Heightmap patches container`;
        this.heightmapViewer = new HeightmapViewer(map);
        this.heightmapContainer.add(this.heightmapViewer.container);
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
        const patchIdCenter = new THREE.Vector3().copy(position).divide(this.patchSize).floor();
        const patchIdTo = voxelTo.divide(this.patchSize).ceil();

        for (const patch of Object.values(this.patches)) {
            patch.visible = false;
        }

        const visibilitySphere = new THREE.Sphere(position, radius);

        type WantedPatch = {
            readonly patchId: THREE.Vector3;
            readonly patchStart: THREE.Vector3;
            readonly distance: number;
        };
        const wantedPatchesList: WantedPatch[] = [];

        const patchId = new THREE.Vector3();
        for (patchId.x = patchIdFrom.x; patchId.x < patchIdTo.x; patchId.x++) {
            for (patchId.y = patchIdFrom.y; patchId.y < patchIdTo.y; patchId.y++) {
                for (patchId.z = patchIdFrom.z; patchId.z < patchIdTo.z; patchId.z++) {
                    const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);

                    const boundingBox = new THREE.Box3(patchStart, patchStart.clone().add(this.patchSize));
                    if (visibilitySphere.intersectsBox(boundingBox)) {
                        wantedPatchesList.push({
                            patchId: patchId.clone(),
                            patchStart,
                            distance: Math.max(
                                Math.abs(patchId.x - patchIdCenter.x),
                                Math.abs(patchId.y - patchIdCenter.y),
                                Math.abs(patchId.z - patchIdCenter.z)
                            ),
                        });
                    }
                }
            }
        }

        wantedPatchesList.sort((patchA: WantedPatch, patchB: WantedPatch) => patchA.distance - patchB.distance);
        const promises = wantedPatchesList.map(wantedPatch => {
            const patch = this.getPatch(wantedPatch.patchStart);
            patch.visible = true;
            return patch.ready();
        });

        this.garbageCollectPatches();

        this.heightmapViewerNeedsUpdate = true;

        await Promise.all(promises);
    }

    /**
     * Call this method before rendering.
     * */
    public update(): void {
        const voxelsSettings = this.parameters.voxels;
        for (const asyncPatch of Object.values(this.patches)) {
            const patch = asyncPatch.patch;
            if (patch) {
                patch.parameters.voxels.displayMode = voxelsSettings.faces.displayMode;
                patch.parameters.voxels.noiseStrength = voxelsSettings.faces.noiseStrength;

                patch.parameters.smoothEdges.enabled = voxelsSettings.smoothEdges.enabled;
                patch.parameters.smoothEdges.radius = voxelsSettings.smoothEdges.radius;
                patch.parameters.smoothEdges.quality = voxelsSettings.smoothEdges.quality;

                patch.parameters.ao.enabled = voxelsSettings.ao.enabled;
                patch.parameters.ao.strength = voxelsSettings.ao.strength;
                patch.parameters.ao.spread = voxelsSettings.ao.spread;

                patch.parameters.shadows = this.parameters.shadows;

                patch.updateUniforms();
            }
        }

        if (this.parameters.lod.enabled) {
            if (!this.heightmapContainer.parent) {
                this.container.add(this.heightmapContainer);
            }

            if (this.heightmapViewerNeedsUpdate) {
                this.heightmapViewer.resetSubdivisions();
                for (const patch of Object.values(this.patches)) {
                    if (patch.hasVisibleMesh()) {
                        this.heightmapViewer.hidePatch(patch.id.x, patch.id.z);
                    }
                }
                this.heightmapViewer.applyVisibility();
                this.heightmapViewer.updateMesh();

                this.heightmapViewerNeedsUpdate = false;
            }
        } else if (this.heightmapContainer.parent) {
            this.container.remove(this.heightmapContainer);
        }
    }

    /**
     * Requests for the LOD map to be precise around a certain position
     * @param focusPoint Coords in voxels of the point to focus
     * @param focusDistance Radius in voxels of the area that must use max LOD quality
     * @param maxVisibilityDistance Radius in voxel of the area that mus be visible
     */
    public setLod(focusPoint: THREE.Vector3Like, focusDistance: number, maxVisibilityDistance: number): void {
        this.heightmapViewer.focusPoint = new THREE.Vector2(focusPoint.x, focusPoint.z);
        this.heightmapViewer.focusDistance = focusDistance;
        this.heightmapViewer.visibilityDistance = maxVisibilityDistance;
        this.heightmapViewerNeedsUpdate = true;
    }

    /**
     * Deletes all the geometry data stored on the GPU.
     * It will be recomputed if needed again.
     */
    public clear(): void {
        for (const patchId of Object.keys(this.patches)) {
            this.disposePatch(patchId);
        }
        this.patchesContainer.clear();
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
            const nextPatchIdToDelete = nextPatchToDelete[0];
            this.disposePatch(nextPatchIdToDelete);
        }
    }

    private disposePatch(patchId: string): void {
        const patch = this.patches[patchId];
        if (patch) {
            patch.dispose();
            logger.diagnostic(`Freeing voxels patch ${patchId}`);
            delete this.patches[patchId];
        } else {
            logger.warn(`Voxels patch ${patchId} does not exist.`);
        }
    }

    private getPatch(patchStart: THREE.Vector3): AsyncPatch {
        const patchId = this.computePatchId(patchStart);

        let patch = this.patches[patchId.asString];
        if (typeof patch === 'undefined') {
            const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);

            const boundingBox = new THREE.Box3(patchStart.clone(), patchEnd.clone());
            const promise = this.patchFactory.buildPatch(patchId, patchStart, patchEnd);
            patch = new AsyncPatch(this.patchesContainer, promise, patchId, boundingBox);
            patch.ready().then(() => {
                if (patch?.hasVisibleMesh) {
                    this.heightmapViewerNeedsUpdate = true;
                }
            });
            this.patches[patchId.asString] = patch;

            logger.diagnostic(`Building voxels patch ${patchId.asString}`);
        }
        return patch;
    }

    private computePatchId(patchStart: THREE.Vector3): PatchId {
        return new PatchId(patchStart.clone().divide(this.patchSize));
    }
}

export { EPatchComputingMode, Terrain, type IVoxelMap };

