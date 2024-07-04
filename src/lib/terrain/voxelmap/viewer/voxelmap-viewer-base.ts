import { createMeshesStatistics, type MeshesStatistics } from '../../../helpers/meshes-statistics';
import * as THREE from '../../../three-usage';
import { type VoxelsChunkSize } from '../i-voxelmap';
import { PatchId } from '../patch/patch-id';
import { EVoxelsDisplayMode } from '../voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';

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
    public readonly container: THREE.Group;

    public readonly parameters = {
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
        shadows: {
            cast: true,
            receive: true,
        },
    };

    public readonly minChunkIdY: number;
    public readonly maxChunkIdY: number;
    public readonly chunkSize: VoxelsChunkSize;
    public readonly patchSize: THREE.Vector3Like;

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

    public applyParameters(): void {
        const voxelsSettings = this.parameters;
        for (const patch of this.allVisiblePatches) {
            const voxelsRenderable = patch.voxelsRenderable;

            voxelsRenderable.parameters.voxels.displayMode = voxelsSettings.faces.displayMode;
            voxelsRenderable.parameters.voxels.noiseStrength = voxelsSettings.faces.noiseStrength;

            voxelsRenderable.parameters.smoothEdges.enabled = voxelsSettings.smoothEdges.enabled;
            voxelsRenderable.parameters.smoothEdges.radius = voxelsSettings.smoothEdges.radius;
            voxelsRenderable.parameters.smoothEdges.quality = voxelsSettings.smoothEdges.quality;

            voxelsRenderable.parameters.ao.enabled = voxelsSettings.ao.enabled;
            voxelsRenderable.parameters.ao.strength = voxelsSettings.ao.strength;
            voxelsRenderable.parameters.ao.spread = voxelsSettings.ao.spread;

            voxelsRenderable.parameters.shadows = this.parameters.shadows;

            voxelsRenderable.updateUniforms();
        }
    }

    public getCompleteChunksColumns(): { x: number; z: number }[] {
        const result: Record<string, { x: number; z: number }> = {};

        const minPatchIdY = this.minChunkIdY;
        const maxPatchIdY = this.maxChunkIdY;

        for (const patch of this.allVisiblePatches) {
            let isWholeColumnDisplayed = true;

            for (let iY = minPatchIdY; iY < maxPatchIdY; iY++) {
                const id = new PatchId({ x: patch.id.x, y: iY, z: patch.id.z });
                if (!this.isPatchAttached(id)) {
                    isWholeColumnDisplayed = false;
                    break;
                }
            }

            if (isWholeColumnDisplayed) {
                const id = `${patch.id.x}_${patch.id.z}`;
                result[id] = patch.id;
            }
        }

        return Object.values(result);
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
