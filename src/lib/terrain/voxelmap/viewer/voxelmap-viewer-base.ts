import { logger } from '../../../helpers/logger';
import { createMeshesStatistics, type MeshesStatistics } from '../../../helpers/meshes-statistics';
import * as THREE from '../../../libs/three-usage';
import { type VoxelsChunkSize } from '../i-voxelmap';
import { PatchId } from '../patch/patch-id';
import { EVoxelsDisplayMode } from '../voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryBase } from '../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

type VoxelmapStatistics = MeshesStatistics & {
    patchSize: THREE.Vector3Like;
};

type PatchRenderable = {
    readonly id: PatchId;
    readonly voxelsRenderable: VoxelsRenderable;
};

type ComputedPatch = {
    readonly isVisible: boolean;
    readonly voxelsRenderable: VoxelsRenderable;
};

abstract class VoxelmapViewerBase {
    public readonly maxSmoothEdgeRadius = VoxelsRenderableFactoryBase.maxSmoothEdgeRadius;

    public readonly container: THREE.Group;

    public readonly parameters = {
        faces: {
            displayMode: EVoxelsDisplayMode.TEXTURED,
            noiseContrast: 0.025,
            checkerboardContrast: 0.1,
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
        shadows: {
            cast: true,
            receive: true,
        },
        grid: {
            enabled: false,
            thickness: 0.02,
            color: new THREE.Vector3(-0.1, -0.1, -0.1),
        },
        specular: {
            strength: 1,
        },
    };

    public readonly minChunkIdY: number;
    public readonly maxChunkIdY: number;
    public readonly chunkSize: VoxelsChunkSize;
    public readonly patchSize: THREE.Vector3Like;

    public readonly onChange: VoidFunction[] = [];

    private maxPatchesInCache = 200;
    private garbageCollectionHandle: number | null;

    protected constructor(minChunkIdX: number, maxChunkIdY: number, chunkSize: VoxelsChunkSize) {
        this.container = new THREE.Group();
        this.container.name = 'Voxelmap container';

        this.minChunkIdY = minChunkIdX;
        this.maxChunkIdY = maxChunkIdY;
        this.chunkSize = chunkSize;
        this.patchSize = { x: chunkSize.xz, y: chunkSize.y, z: chunkSize.xz };

        this.garbageCollectionHandle = window.setInterval(() => this.garbageCollectPatches(this.maxPatchesInCache), 5000);
    }

    public update(): void {
        const voxelsSettings = this.parameters;
        for (const patch of this.allVisiblePatches) {
            const voxelsRenderable = patch.voxelsRenderable;

            voxelsRenderable.parameters.voxels.displayMode = voxelsSettings.faces.displayMode;
            voxelsRenderable.parameters.voxels.noiseStrength = voxelsSettings.faces.noiseContrast;
            voxelsRenderable.parameters.voxels.checkerboardStrength = voxelsSettings.faces.checkerboardContrast;

            voxelsRenderable.parameters.smoothEdges.enabled = voxelsSettings.smoothEdges.enabled;
            voxelsRenderable.parameters.smoothEdges.radius = voxelsSettings.smoothEdges.radius;
            voxelsRenderable.parameters.smoothEdges.quality = voxelsSettings.smoothEdges.quality;

            voxelsRenderable.parameters.ao.enabled = voxelsSettings.ao.enabled;
            voxelsRenderable.parameters.ao.strength = voxelsSettings.ao.strength;
            voxelsRenderable.parameters.ao.spread = voxelsSettings.ao.spread;

            voxelsRenderable.parameters.shadows = voxelsSettings.shadows;

            voxelsRenderable.parameters.grid.enabled = voxelsSettings.grid.enabled;
            voxelsRenderable.parameters.grid.thickness = voxelsSettings.grid.thickness;
            voxelsRenderable.parameters.grid.color = voxelsSettings.grid.color;

            voxelsRenderable.parameters.specular.strength = Math.max(0.0001, voxelsSettings.specular.strength);

            voxelsRenderable.updateUniforms();
        }
    }

    public getCompleteChunksColumns(): { x: number; z: number }[] {
        type Column = {
            id: { x: number; z: number };
            yFilled: number[];
        };

        const columns = new Map<string, Column>();

        const minPatchIdY = this.minChunkIdY;
        const maxPatchIdY = this.maxChunkIdY;
        const requiredPatchIdYList: number[] = [];
        for (let iY = minPatchIdY; iY < maxPatchIdY; iY++) {
            requiredPatchIdYList.push(iY);
        }

        for (const patch of this.allVisiblePatches) {
            for (const y of requiredPatchIdYList) {
                const id = new PatchId({ x: patch.id.x, y, z: patch.id.z });
                if (this.isPatchAttached(id)) {
                    const columnId = `${patch.id.x}_${patch.id.z}`;
                    let column = columns.get(columnId);
                    if (!column) {
                        column = {
                            id: { x: patch.id.x, z: patch.id.z },
                            yFilled: [],
                        };
                        columns.set(columnId, column);
                    }
                    column.yFilled.push(y);
                }
            }
        }

        const completeColumnIdsList: { x: number; z: number }[] = [];
        for (const column of columns.values()) {
            const missingYList: number[] = [];

            for (const y of requiredPatchIdYList) {
                if (!column.yFilled.includes(y)) {
                    missingYList.push(y);
                }
            }

            if (missingYList.length === 0) {
                completeColumnIdsList.push(column.id);
            } else {
                logger.diagnostic(`Incomplete colum "x=${column.id.x};z=${column.id.z}": missing y=${missingYList.join(',')}`);
            }
        }
        return completeColumnIdsList;
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
        this.garbageCollectPatches(this.maxPatchesInCache);
    }

    /**
     * Computes and returns technical statistics about the voxelmap.
     */
    public getStatistics(): VoxelmapStatistics {
        const result = Object.assign(createMeshesStatistics(), {
            patchSize: new THREE.Vector3().copy(this.patchSize),
        });

        for (const patch of this.allLoadedPatches) {
            result.meshes.loadedCount++;
            result.triangles.loadedCount += patch.voxelsRenderable.trianglesCount;

            if (patch.isVisible) {
                result.meshes.visibleCount++;
                result.triangles.visibleCount += patch.voxelsRenderable.trianglesCount;
            }

            result.gpuMemoryBytes += patch.voxelsRenderable.gpuMemoryBytes;
        }

        return result;
    }

    protected notifyChange(): void {
        for (const callback of this.onChange) {
            callback();
        }
    }

    protected dispose(): void {
        if (this.garbageCollectionHandle) {
            clearInterval(this.garbageCollectionHandle);
            this.garbageCollectionHandle = null;
        }
    }

    protected abstract get allLoadedPatches(): ComputedPatch[];
    protected abstract get allVisiblePatches(): PatchRenderable[];
    protected abstract isPatchAttached(patchId: PatchId): boolean;
    protected abstract garbageCollectPatches(maxInvisiblePatchesInPatch: number): void;
}

export { VoxelmapViewerBase, type ComputedPatch, type PatchRenderable, type VoxelmapStatistics };
