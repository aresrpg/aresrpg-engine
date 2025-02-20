import { PromisesQueue } from '../../../helpers/async/promises-queue';
import { logger } from '../../../helpers/logger';
import { vec3ToString } from '../../../helpers/string';
import * as THREE from '../../../libs/three-usage';
import { type MaterialsStore } from '../../materials-store';
import { ChunkId } from '../chunk/chunk-id';
import { type ChunkRenderableFactoryBase } from '../chunk/chunkRenderableFactory/chunk-renderable-factory-base';
import { ChunkRenderableFactoryCpu } from '../chunk/chunkRenderableFactory/cpu/chunk-renderable-factory-cpu';
import { ChunkRenderableFactoryCpuWorker } from '../chunk/chunkRenderableFactory/cpu/chunk-renderable-factory-cpu-worker';
import { ChunkRenderableFactoryGpu } from '../chunk/chunkRenderableFactory/gpu/chunk-renderable-facory-gpu';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../i-voxelmap';
import { type CheckerboardType, type VoxelsChunkData } from '../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { AsyncChunkRenderable, EComputationResult, type AdaptativeQualityParameters } from './async-chunk-renderable';
import { VoxelmapViewerBase, type ChunkRenderable, type ComputedChunk } from './voxelmap-viewer-base';

enum EComputationMethod {
    CPU_MONOTHREADED,
    CPU_MULTITHREADED,
    GPU,
}

type ComputationOptions =
    | {
          readonly method: EComputationMethod.GPU;
      }
    | {
          readonly method: EComputationMethod.CPU_MONOTHREADED;
          readonly greedyMeshing?: boolean;
      }
    | {
          readonly method: EComputationMethod.CPU_MULTITHREADED;
          readonly threadsCount: number;
          readonly greedyMeshing?: boolean;
      };

type VoxelmapViewerOptions = {
    readonly transitionTime?: number;
    readonly chunkSize?: VoxelsChunkSize;
    readonly computationOptions?: ComputationOptions;
    readonly checkerboardType?: CheckerboardType;
    readonly voxelsChunkOrdering?: VoxelsChunkOrdering;
};

class VoxelmapViewer extends VoxelmapViewerBase {
    public readonly computationOptions: ComputationOptions;
    public readonly maxChunksComputedInParallel: number;

    private readonly promiseThrottler: PromisesQueue;
    private readonly chunkRenderableFactory: ChunkRenderableFactoryBase;

    private readonly asyncChunks = new Map<string, AsyncChunkRenderable>();

    private readonly transitionTime: number;

    public constructor(minChunkIdY: number, maxChunkIdY: number, voxelMaterialsStore: MaterialsStore, options?: VoxelmapViewerOptions) {
        const chunkSize = options?.chunkSize ?? { xz: 64, y: 64 };
        super(minChunkIdY, maxChunkIdY, chunkSize);

        this.computationOptions = options?.computationOptions || {
            method: EComputationMethod.CPU_MULTITHREADED,
            threadsCount: 3,
        };

        let checkerboardType: CheckerboardType = 'xyz';
        if (options?.checkerboardType) {
            checkerboardType = options.checkerboardType;
        }

        const voxelsChunkOrdering = options?.voxelsChunkOrdering ?? 'zyx';

        if (this.computationOptions.method === EComputationMethod.CPU_MONOTHREADED) {
            this.chunkRenderableFactory = new ChunkRenderableFactoryCpu({
                voxelMaterialsStore,
                maxVoxelsChunkSize: chunkSize,
                checkerboardType,
                greedyMeshing: this.computationOptions.greedyMeshing ?? true,
                voxelsChunkOrdering,
            });
        } else if (this.computationOptions.method === EComputationMethod.CPU_MULTITHREADED) {
            this.chunkRenderableFactory = new ChunkRenderableFactoryCpuWorker({
                voxelMaterialsStore,
                maxVoxelsChunkSize: chunkSize,
                workersPoolSize: this.computationOptions.threadsCount,
                checkerboardType,
                greedyMeshing: this.computationOptions.greedyMeshing ?? true,
                voxelsChunkOrdering,
            });
        } else {
            this.chunkRenderableFactory = new ChunkRenderableFactoryGpu({
                voxelMaterialsStore,
                voxelsChunkSize: chunkSize,
                voxelsChunkOrdering,
                checkerboardType,
            });
        }
        this.maxChunksComputedInParallel = this.chunkRenderableFactory.maxChunksComputedInParallel;

        this.promiseThrottler = new PromisesQueue(this.maxChunksComputedInParallel);

        this.transitionTime = options?.transitionTime ?? 250;
    }

    public override update(): void {
        for (const asyncChunk of this.asyncChunks.values()) {
            asyncChunk.update();
        }

        super.update();
    }

    public doesChunkRequireVoxelsData(id: THREE.Vector3Like): boolean {
        const chunkId = new ChunkId(id);
        const asyncChunk = this.asyncChunks.get(chunkId.asString);
        return !asyncChunk || asyncChunk.needsNewData();
    }

    public async enqueueChunk(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<EComputationResult> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.chunkSizeVec3)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}.`);
        }

        const chunkId = new ChunkId(id);
        let asyncChunk = this.asyncChunks.get(chunkId.asString);
        if (!asyncChunk) {
            asyncChunk = new AsyncChunkRenderable({ parent: this.container, id: chunkId, transitionTime: this.transitionTime });
            asyncChunk.onVisibilityChange.push(() => this.notifyChange());
            this.asyncChunks.set(chunkId.asString, asyncChunk);
        }
        if (!asyncChunk.needsNewData()) {
            logger.debug(`Skipping unnecessary computation of up-do-date chunk "${chunkId.asString}".`);
            return Promise.resolve(EComputationResult.SKIPPED);
        }

        const computationTask = async () => {
            if (voxelsChunkData.isEmpty) {
                return null;
            }
            const chunkStart = new THREE.Vector3().multiplyVectors(chunkId, this.chunkSizeVec3);
            const chunkEnd = new THREE.Vector3().addVectors(chunkStart, this.chunkSizeVec3);
            return await this.chunkRenderableFactory.buildChunkRenderable(chunkId, chunkStart, chunkEnd, voxelsChunkData);
        };

        return asyncChunk.scheduleNewComputation(computationTask, this.promiseThrottler);
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
    }

    public dequeueChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        const asyncChunk = this.asyncChunks.get(chunkId.asString);
        asyncChunk?.cancelScheduledComputation();
    }

    public invalidateChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        const asyncChunk = this.asyncChunks.get(chunkId.asString);
        asyncChunk?.flagAsObsolete();
    }

    public deleteChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        const asyncChunk = this.asyncChunks.get(chunkId.asString);
        if (asyncChunk) {
            asyncChunk.cancelScheduledComputation();
            asyncChunk.deleteComputationResults();
        }
    }

    public setVisibility(visibleChunksIds: Iterable<THREE.Vector3Like>): void {
        const visibleChunksIdsSet = new Set<string>();
        for (const visibleChunkId of visibleChunksIds) {
            const chunkid = new ChunkId(visibleChunkId);
            visibleChunksIdsSet.add(chunkid.asString);

            if (!this.asyncChunks.has(chunkid.asString)) {
                this.asyncChunks.set(
                    chunkid.asString,
                    new AsyncChunkRenderable({ parent: this.container, id: chunkid, transitionTime: this.transitionTime })
                );
            }
        }

        for (const [chunkId, asyncChunk] of this.asyncChunks.entries()) {
            const shouldBeVisible = visibleChunksIdsSet.has(chunkId);
            asyncChunk.setVisible(shouldBeVisible);
        }
    }

    public override dispose(): void {
        super.dispose();
        throw new Error('Not implemented');
    }

    public getChunkBox(id: THREE.Vector3Like): THREE.Box3 {
        const voxelFrom = new THREE.Vector3().multiplyVectors(id, this.chunkSizeVec3).subScalar(1);
        const voxelTo = voxelFrom.clone().add(this.chunkSizeVec3).addScalar(2);
        return new THREE.Box3(voxelFrom, voxelTo);
    }

    public setAdaptativeQuality(parameters: AdaptativeQualityParameters): void {
        for (const asyncChunk of this.asyncChunks.values()) {
            asyncChunk.updateDisplayQuality(parameters);
        }
    }

    protected override get allLoadedChunks(): ComputedChunk[] {
        const result: ComputedChunk[] = [];
        for (const asyncChunk of this.asyncChunks.values()) {
            const voxelsRenderable = asyncChunk.tryGetVoxelsRenderable();
            if (voxelsRenderable)
                result.push({
                    isVisible: asyncChunk.isMeshInScene(),
                    voxelsRenderable,
                });
        }
        return result;
    }

    protected override get allVisibleChunks(): ChunkRenderable[] {
        const result: ChunkRenderable[] = [];

        for (const asyncChunk of this.asyncChunks.values()) {
            const voxelsRenderable = asyncChunk.tryGetVoxelsRenderable();
            if (voxelsRenderable && asyncChunk.isMeshInScene()) {
                result.push({ id: asyncChunk.id, voxelsRenderable });
            }
        }

        return result;
    }

    protected override isChunkAttached(chunkId: ChunkId): boolean {
        const asyncChunk = this.asyncChunks.get(chunkId.asString);
        if (asyncChunk) {
            return asyncChunk.isAttached();
        }
        return false;
    }

    protected override garbageCollect(maxInvisibleChunksInCache: number): void {
        type InvisibleChunk = {
            readonly asyncChunk: AsyncChunkRenderable;
            readonly invisibleSinceTimestamp: number;
        };

        const invisibleChunksList: InvisibleChunk[] = [];
        for (const asyncChunk of this.asyncChunks.values()) {
            const invisibleSinceTimestamp = asyncChunk.isDetachedSince();
            if (invisibleSinceTimestamp !== null) {
                invisibleChunksList.push({ asyncChunk, invisibleSinceTimestamp });
            }
        }
        // oldest last
        invisibleChunksList.sort((ip1: InvisibleChunk, ip2: InvisibleChunk) => ip2.invisibleSinceTimestamp - ip1.invisibleSinceTimestamp);

        let nextChunkToDelete = invisibleChunksList.pop();
        while (nextChunkToDelete && invisibleChunksList.length > maxInvisibleChunksInCache) {
            nextChunkToDelete.asyncChunk.dispose();
            this.asyncChunks.delete(nextChunkToDelete.asyncChunk.id.asString);

            nextChunkToDelete = invisibleChunksList.pop();
        }
    }
}

export {
    EComputationMethod,
    EComputationResult,
    VoxelmapViewer,
    type ComputationOptions,
    type VoxelmapViewerOptions,
    type VoxelsChunkData,
};
