import { DisposableMap } from '../helpers/disposable-map';
import { logger } from '../helpers/logger';
import { createMeshesStatistics, type MeshesStatistics } from '../helpers/meshes-statistics';
import { vec3ToString } from '../helpers/string';
import * as THREE from '../three-usage';

import { AsyncPatch } from './async-patch';
import { HeightmapViewer, type HeightmapStatistics } from './heightmap/heightmap-viewer';
import { type IHeightmap } from './heightmap/i-heightmap';
import { type IVoxelMap } from './voxelmap/i-voxelmap';
import { PatchFactoryCpu } from './voxelmap/patch/patch-factory/merged/patch-factory-cpu';
import { PatchFactoryGpuOptimized } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-optimized';
import { PatchFactoryGpuSequential } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from './voxelmap/patch/patch-factory/patch-factory-base';
import { PatchId } from './voxelmap/patch/patch-id';
import { EVoxelsDisplayMode } from './voxelmap/voxelsRenderable/voxels-renderable';
import { type VoxelsChunkSize } from './voxelmap/voxelsRenderable/voxelsRenderableFactory/merged/vertex-data1-encoder';

type TerrainOptions = {
    computingMode?: EPatchComputingMode;
    patchSize?: VoxelsChunkSize;
};

type VoxelMapStatistics = MeshesStatistics & {
    patchSize: THREE.Vector3Like;
};

type TerrainStatistics = {
    voxelmap: VoxelMapStatistics;
    heightmap: HeightmapStatistics;
};

enum EPatchComputingMode {
    CPU_CACHED,
    GPU_SEQUENTIAL,
    GPU_OPTIMIZED,
}

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
                displayMode: EVoxelsDisplayMode.TEXTURED,
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
            map: {
                minAltitude: -1,
                maxAltitude: 256,
            },
        },
        lod: {
            enabled: true,
            wireframe: false,
        },
    };

    private readonly patchesContainer: THREE.Group;
    private readonly heightmapContainer: THREE.Group;

    private maxPatchesInCache = 200;

    private readonly patchFactory: PatchFactoryBase;
    private readonly patchSize: THREE.Vector3;

    private readonly patchesStore: DisposableMap<AsyncPatch> = new DisposableMap<AsyncPatch>();

    private readonly heightmapViewer: HeightmapViewer;
    private heightmapViewerNeedsUpdate: boolean = true;

    /**
     *
     * @param map The map that will be rendered.
     */
    public constructor(map: IVoxelMap & IHeightmap, options?: TerrainOptions) {
        let computingMode = EPatchComputingMode.GPU_OPTIMIZED;
        let patchSize = { xz: 64, y: 64 };
        if (options) {
            if (typeof options.computingMode !== 'undefined') {
                computingMode = options.computingMode;
            }
            if (typeof options.patchSize !== 'undefined') {
                patchSize = options.patchSize;
            }
        }

        if (computingMode === EPatchComputingMode.CPU_CACHED) {
            this.patchFactory = new PatchFactoryCpu(map, patchSize);
        } else if (computingMode === EPatchComputingMode.GPU_SEQUENTIAL) {
            this.patchFactory = new PatchFactoryGpuSequential(map, patchSize);
        } else if (computingMode === EPatchComputingMode.GPU_OPTIMIZED) {
            this.patchFactory = new PatchFactoryGpuOptimized(map, patchSize);
        } else {
            throw new Error(`Unsupported computing mode "${computingMode}".`);
        }

        this.patchSize = this.patchFactory.maxPatchSize.clone();
        logger.info(`Using max patch size ${vec3ToString(this.patchSize)}.`);

        this.container = new THREE.Group();
        this.container.name = 'Terrain container';

        this.patchesContainer = new THREE.Group();
        this.patchesContainer.name = 'Voxel patches container';
        this.container.add(this.patchesContainer);

        this.heightmapContainer = new THREE.Group();
        this.heightmapContainer.name = `Heightmap patches container`;
        this.heightmapViewer = new HeightmapViewer(map, patchSize.xz);
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

        for (const patch of this.patchesStore.allItems) {
            patch.visible = false;
        }

        const visibilitySphere = new THREE.Sphere(new THREE.Vector3(position.x, 0, position.z), radius);

        type WantedPatch = {
            readonly patchId: THREE.Vector3;
            readonly patchStart: THREE.Vector3;
            readonly distance: number;
        };
        const wantedPatchesList: WantedPatch[] = [];

        const patchId = new THREE.Vector3();
        for (patchId.x = patchIdFrom.x; patchId.x < patchIdTo.x; patchId.x++) {
            for (patchId.z = patchIdFrom.z; patchId.z < patchIdTo.z; patchId.z++) {
                patchId.y = 0;

                let patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);

                const boundingBox = new THREE.Box3(patchStart, patchStart.clone().add(this.patchSize));
                if (visibilitySphere.intersectsBox(boundingBox)) {
                    for (patchId.y = this.minPatchIdY; patchId.y < this.maxPatchIdY; patchId.y++) {
                        patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
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
        for (const asyncPatch of this.patchesStore.allItems) {
            const patch = asyncPatch.renderable;
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

            this.heightmapViewer.wireframe = this.parameters.lod.wireframe;

            if (this.heightmapViewerNeedsUpdate) {
                this.heightmapViewer.resetSubdivisions();
                for (const patch of this.patchesStore.allItems) {
                    let wholeColumnIsDisplayed = true;

                    for (let iY = this.minPatchIdY; iY < this.maxPatchIdY; iY++) {
                        const id = new PatchId({ x: patch.id.x, y: iY, z: patch.id.z });
                        const columnNeighbour = this.patchesStore.getItem(id.asString);
                        if (!columnNeighbour || !columnNeighbour.isReady || !columnNeighbour.visible) {
                            wholeColumnIsDisplayed = false;
                            break;
                        }
                    }

                    if (wholeColumnIsDisplayed) {
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
        this.patchesStore.clear();
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

    /**
     * Computes and returns technical statistics about the terrain.
     */
    public getStatistics(): TerrainStatistics {
        const result: TerrainStatistics = {
            voxelmap: Object.assign(createMeshesStatistics(), {
                patchSize: this.patchSize.clone(),
            }),
            heightmap: this.heightmapViewer.getStatistics(),
        };

        for (const patch of this.patchesStore.allItems) {
            if (patch.renderable) {
                result.voxelmap.meshes.loadedCount++;
                result.voxelmap.triangles.loadedCount += patch.renderable.trianglesCount;

                if (patch.visible) {
                    result.voxelmap.meshes.visibleCount++;
                    result.voxelmap.triangles.visibleCount += patch.renderable.trianglesCount;
                }

                result.voxelmap.gpuMemoryBytes += patch.renderable.gpuMemoryBytes;
            }
        }

        return result;
    }

    private get minPatchIdY(): number {
        return Math.floor(this.parameters.voxels.map.minAltitude / this.patchFactory.maxPatchSize.y);
    }

    private get maxPatchIdY(): number {
        return Math.ceil(this.parameters.voxels.map.maxAltitude / this.patchFactory.maxPatchSize.y);
    }

    private garbageCollectPatches(): void {
        const patches = this.patchesStore.allItems;
        const invisiblePatches = patches.filter(patch => !patch.visible);
        invisiblePatches.sort((patch1, patch2) => patch1.invisibleSince - patch2.invisibleSince);

        while (invisiblePatches.length > this.maxPatchesInCache) {
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

            const promise = this.patchFactory.buildPatch(patchId, patchStart, patchEnd);
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
