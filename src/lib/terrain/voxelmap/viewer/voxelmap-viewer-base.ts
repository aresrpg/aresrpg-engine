import { logger } from '../../../helpers/logger';
import { createMeshesStatistics } from '../../../helpers/meshes-statistics';
import * as THREE from '../../../libs/three-usage';
import { ChunkId } from '../chunk/chunk-id';
import { type VoxelsChunkSize } from '../i-voxelmap';
import { type IVoxelmapViewer, type VoxelmapStatistics } from '../i-voxelmap-viewer';
import { EVoxelsDisplayMode } from '../voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryBase } from '../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

type ChunkRenderable = {
    readonly id: ChunkId;
    readonly voxelsRenderable: VoxelsRenderable;
};

type ComputedChunk = {
    readonly isVisible: boolean;
    readonly voxelsRenderable: VoxelsRenderable;
};

type Parameters = {
    readonly chunkSize: VoxelsChunkSize;
    readonly chunkIdY: {
        readonly min: number;
        readonly max: number;
    };
};

abstract class VoxelmapViewerBase implements IVoxelmapViewer {
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
    public readonly chunkSizeVec3: THREE.Vector3Like;

    public readonly onChange: VoidFunction[] = [];

    private maxChunksInCache = 200;
    private garbageCollectionHandle: number | null;

    protected constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'voxelmap-viewer-container';

        this.minChunkIdY = params.chunkIdY.min;
        this.maxChunkIdY = params.chunkIdY.max;
        this.chunkSize = params.chunkSize;
        this.chunkSizeVec3 = { x: params.chunkSize.xz, y: params.chunkSize.y, z: params.chunkSize.xz };

        this.garbageCollectionHandle = window.setInterval(() => this.garbageCollect(this.maxChunksInCache), 5000);
    }

    public update(): void {
        const voxelsSettings = this.parameters;
        for (const chunk of this.allVisibleChunks) {
            const voxelsRenderable = chunk.voxelsRenderable;

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
            missingYBlocks: Set<number>;
        };

        const columns = new Map<string, Column>();

        const requiredChunksIdsYList: number[] = [];
        for (let iY = this.minChunkIdY; iY < this.maxChunkIdY; iY++) {
            requiredChunksIdsYList.push(iY);
        }

        for (const chunk of this.allVisibleChunks) {
            for (const y of requiredChunksIdsYList) {
                const id = new ChunkId({ x: chunk.id.x, y, z: chunk.id.z });
                if (this.isChunkAttached(id)) {
                    const columnId = `${chunk.id.x}_${chunk.id.z}`;
                    let column = columns.get(columnId);
                    if (!column) {
                        column = {
                            id: { x: chunk.id.x, z: chunk.id.z },
                            missingYBlocks: new Set(requiredChunksIdsYList),
                        };
                        columns.set(columnId, column);
                    }
                    column.missingYBlocks.delete(y);
                }
            }
        }

        const completeColumnIdsList: { x: number; z: number }[] = [];
        for (const column of columns.values()) {
            if (column.missingYBlocks.size === 0) {
                completeColumnIdsList.push(column.id);
            } else {
                const missingYList = Array.from(column.missingYBlocks);
                logger.diagnostic(`Incomplete colum "x=${column.id.x};z=${column.id.z}": missing y=${missingYList.join(',')}`);
            }
        }
        return completeColumnIdsList;
    }

    /**
     * Gets the maximum size of the GPU LRU cache of invisible chunks.
     */
    public get chunksCacheSize(): number {
        return this.maxChunksInCache;
    }

    /**
     * Sets the maximum size of the GPU LRU cache of invisible chunks.
     */
    public set chunksCacheSize(value: number) {
        if (value <= 0) {
            throw new Error(`Invalid chunks cache size "${value}".`);
        }
        this.maxChunksInCache = value;
        this.garbageCollect(this.maxChunksInCache);
    }

    /**
     * Computes and returns technical statistics about the voxelmap.
     */
    public getStatistics(): VoxelmapStatistics {
        const result = Object.assign(createMeshesStatistics(), {
            chunkSize: new THREE.Vector3().copy(this.chunkSizeVec3),
        });

        for (const chunk of this.allLoadedChunks) {
            result.meshes.loadedCount++;
            result.triangles.loadedCount += chunk.voxelsRenderable.trianglesCount;

            if (chunk.isVisible) {
                result.meshes.visibleCount++;
                result.triangles.visibleCount += chunk.voxelsRenderable.trianglesCount;
            }

            result.gpuMemoryBytes += chunk.voxelsRenderable.gpuMemoryBytes;
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

    protected abstract get allLoadedChunks(): ComputedChunk[];
    protected abstract get allVisibleChunks(): ChunkRenderable[];
    protected abstract isChunkAttached(chunkId: ChunkId): boolean;
    protected abstract garbageCollect(maxInvisibleChunksInCache: number): void;
}

export { VoxelmapViewerBase, type ChunkRenderable, type ComputedChunk, type VoxelmapStatistics };
