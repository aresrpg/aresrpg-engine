import { AsyncTask } from '../../../../helpers/async/async-task';
import { PromisesQueue } from '../../../../helpers/async/promises-queue';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type IVoxelMaterial, type VoxelsChunkSize } from '../../i-voxelmap';
import { PatchFactoryCpu } from '../../patch/patch-factory/merged/patch-factory-cpu';
import { PatchFactoryCpuWorker } from '../../patch/patch-factory/merged/patch-factory-cpu-worker';
import { PatchFactoryGpuSequential } from '../../patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from '../../patch/patch-factory/patch-factory-base';
import { PatchId } from '../../patch/patch-id';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';
import { type CheckerboardType, type VoxelsChunkData } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { VoxelmapViewerBase, type ComputedPatch, type PatchRenderable } from '../voxelmap-viewer-base';

enum EComputationMethod {
    CPU_MONOTHREADED,
    CPU_MULTITHREADED,
    GPU,
}

type ComputationOptions =
    | {
          readonly method: EComputationMethod.CPU_MONOTHREADED | EComputationMethod.GPU;
      }
    | {
          readonly method: EComputationMethod.CPU_MULTITHREADED;
          readonly threadsCount: number;
      };

type VoxelmapViewerOptions = {
    patchSize?: VoxelsChunkSize;
    computationOptions?: ComputationOptions;
    checkerboardType?: CheckerboardType;
};

type ComputationStatus = 'success' | 'skipped' | 'aborted';

type StoredPatchRenderable =
    | {
          readonly id: PatchId;
          readonly status: 'pending';
          isVisible: boolean;
          isInvisibleSince: number;
      }
    | {
          readonly id: PatchId;
          readonly status: 'ready';
          isVisible: boolean;
          isInvisibleSince: number;
          readonly renderable: VoxelsRenderable | null;
      };

type EnqueuedPatchRenderable = {
    readonly id: PatchId;
    readonly status: 'in-queue';
    readonly computationTask: AsyncTask<VoxelsRenderable | null>;
    cancelled: boolean;
};

class VoxelmapViewer extends VoxelmapViewerBase {
    public readonly computationOptions: ComputationOptions;
    public readonly maxPatchesComputedInParallel: number;

    private readonly promiseThrottler: PromisesQueue;
    private readonly patchFactory: PatchFactoryBase;

    private patchesStore: Record<string, StoredPatchRenderable> = {};
    private enqueuedPatchesStore: Record<string, EnqueuedPatchRenderable> = {};

    public constructor(
        minChunkIdY: number,
        maxChunkIdY: number,
        voxelsMaterialsList: ReadonlyArray<IVoxelMaterial>,
        options?: VoxelmapViewerOptions
    ) {
        let voxelsChunksSize = { xz: 64, y: 64 };
        if (options?.patchSize) {
            voxelsChunksSize = options.patchSize;
        }

        super(minChunkIdY, maxChunkIdY, voxelsChunksSize);

        this.computationOptions = options?.computationOptions || {
            method: EComputationMethod.CPU_MULTITHREADED,
            threadsCount: 3,
        };

        let checkerboardType: CheckerboardType = 'xyz';
        if (options?.checkerboardType) {
            checkerboardType = options.checkerboardType;
        }

        if (this.computationOptions.method === EComputationMethod.CPU_MONOTHREADED) {
            this.patchFactory = new PatchFactoryCpu(voxelsMaterialsList, voxelsChunksSize, checkerboardType);
            this.maxPatchesComputedInParallel = 1;
        } else if (this.computationOptions.method === EComputationMethod.CPU_MULTITHREADED) {
            this.patchFactory = new PatchFactoryCpuWorker(
                voxelsMaterialsList,
                voxelsChunksSize,
                this.computationOptions.threadsCount,
                checkerboardType
            );
            this.maxPatchesComputedInParallel = this.computationOptions.threadsCount;
        } else {
            this.patchFactory = new PatchFactoryGpuSequential(voxelsMaterialsList, voxelsChunksSize, checkerboardType);
            this.maxPatchesComputedInParallel = 1;
        }

        this.promiseThrottler = new PromisesQueue(this.maxPatchesComputedInParallel);
    }

    public doesPatchRequireVoxelsData(id: THREE.Vector3Like): boolean {
        const patchId = new PatchId(id);
        const storedPatch = this.getOrBuildStoredPatch(patchId);
        return storedPatch.status === 'pending';
    }

    public async enqueuePatch(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<ComputationStatus> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}.`);
        }

        const patchId = new PatchId(id);
        const storedPatch = this.getOrBuildStoredPatch(patchId);
        if (storedPatch.status !== 'pending') {
            return Promise.resolve('skipped');
        }

        const existingEnqueuedPatch = this.enqueuedPatchesStore[patchId.asString];
        if (existingEnqueuedPatch) {
            return Promise.resolve('skipped');
        }

        return new Promise<ComputationStatus>(resolve => {
            const resolveAsAborted = () => resolve('aborted');

            const enqueuedPatch: EnqueuedPatchRenderable = {
                id: patchId,
                status: 'in-queue',
                computationTask: new AsyncTask<VoxelsRenderable | null>(async () => {
                    const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                    const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
                    return await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);
                }),
                cancelled: false,
            };
            this.enqueuedPatchesStore[patchId.asString] = enqueuedPatch;

            this.promiseThrottler.run(async () => {
                if (enqueuedPatch.cancelled) {
                    resolveAsAborted();
                    return;
                }

                const voxelsRenderable = await enqueuedPatch.computationTask.start();

                if (enqueuedPatch.cancelled) {
                    if (voxelsRenderable) {
                        voxelsRenderable.dispose();
                    }
                    resolveAsAborted();
                    return;
                }

                if (this.enqueuedPatchesStore[patchId.asString] !== enqueuedPatch) {
                    throw new Error();
                }
                delete this.enqueuedPatchesStore[patchId.asString];

                const storedPatch = this.patchesStore[patchId.asString];
                if (!storedPatch) {
                    throw new Error();
                }
                if (storedPatch.status !== 'pending') {
                    throw new Error();
                }

                this.patchesStore[patchId.asString] = {
                    id: storedPatch.id,
                    isVisible: storedPatch.isVisible,
                    isInvisibleSince: storedPatch.isInvisibleSince,
                    status: 'ready',
                    renderable: voxelsRenderable,
                };

                if (voxelsRenderable && storedPatch.isVisible) {
                    this.container.add(voxelsRenderable.container);
                    this.notifyChange();
                }

                resolve('success');
            }, resolveAsAborted);
        });
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
    }

    public dequeuePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);
        const enqueuedPatch = this.enqueuedPatchesStore[patchId.asString];
        if (enqueuedPatch) {
            enqueuedPatch.cancelled = true;
            delete this.enqueuedPatchesStore[patchId.asString];
        }
    }

    public deletePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);

        const patch = this.patchesStore[patchId.asString];
        if (patch && patch.status === 'ready') {
            if (patch.renderable) {
                if (patch.isVisible) {
                    this.container.remove(patch.renderable.container);
                }
                patch.renderable.dispose();
            }
            this.patchesStore[patchId.asString] = {
                id: patch.id,
                isVisible: patch.isVisible,
                isInvisibleSince: patch.isInvisibleSince,
                status: 'pending',
            };
        }

        const enqueuedPatch = this.enqueuedPatchesStore[patchId.asString];
        if (enqueuedPatch) {
            enqueuedPatch.cancelled = true;
            delete this.enqueuedPatchesStore[patchId.asString];
        }
    }

    public setVisibility(visiblePatchesId: ReadonlyArray<THREE.Vector3Like>): void {
        for (const patch of Object.values(this.patchesStore)) {
            if (patch.isVisible) {
                if (patch.status === 'ready' && patch.renderable) {
                    this.container.remove(patch.renderable.container);
                }
                patch.isVisible = false;
                patch.isInvisibleSince = performance.now();
            }
        }

        for (const id of visiblePatchesId) {
            const visiblePatchId = new PatchId(id);
            const patch = this.getOrBuildStoredPatch(visiblePatchId);
            if (!patch.isVisible) {
                if (patch.status === 'ready' && patch.renderable) {
                    this.container.add(patch.renderable.container);
                }
                patch.isVisible = true;
                patch.isInvisibleSince = -1;
            }
        }

        this.notifyChange();
    }

    public override dispose(): void {
        super.dispose();
        throw new Error('Not implemented');
    }

    public getPatchVoxelsBox(id: THREE.Vector3Like): THREE.Box3 {
        const voxelFrom = new THREE.Vector3().multiplyVectors(id, this.patchSize).subScalar(1);
        const voxelTo = voxelFrom.clone().add(this.patchSize).addScalar(2);
        return new THREE.Box3(voxelFrom, voxelTo);
    }

    protected override get allLoadedPatches(): ComputedPatch[] {
        const result: ComputedPatch[] = [];
        for (const patch of Object.values(this.patchesStore)) {
            if (patch.status === 'ready' && patch.renderable)
                result.push({
                    isVisible: patch.isVisible,
                    voxelsRenderable: patch.renderable,
                });
        }
        return result;
    }

    protected override get allVisiblePatches(): PatchRenderable[] {
        const result: PatchRenderable[] = [];

        for (const storedPatch of Object.values(this.patchesStore)) {
            if (storedPatch.status === 'ready' && storedPatch.isVisible && storedPatch.renderable) {
                result.push({ id: storedPatch.id, voxelsRenderable: storedPatch.renderable });
            }
        }

        return result;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const storedPatch = this.patchesStore[patchId.asString];
        return storedPatch?.status === 'ready' && storedPatch.isVisible;
    }

    protected override garbageCollectPatches(maxInvisiblePatchesInPatch: number): void {
        const storedPatchesList = Object.values(this.patchesStore);
        const elligibleStoredPatchesList = storedPatchesList.filter(storedPatch => {
            return !storedPatch.isVisible && (storedPatch.status === 'pending' || storedPatch.status === 'ready');
        });
        elligibleStoredPatchesList.sort((patch1, patch2) => patch1.isInvisibleSince - patch2.isInvisibleSince);

        while (elligibleStoredPatchesList.length > maxInvisiblePatchesInPatch) {
            const nextPatchToDelete = elligibleStoredPatchesList.shift();
            if (!nextPatchToDelete) {
                break;
            }
            if (nextPatchToDelete.status === 'ready') {
                nextPatchToDelete.renderable?.dispose();
            }
            delete this.patchesStore[nextPatchToDelete.id.asString];
        }
    }

    private getOrBuildStoredPatch(patchId: PatchId): StoredPatchRenderable {
        let storedPatch = this.patchesStore[patchId.asString];
        if (!storedPatch) {
            storedPatch = {
                id: patchId,
                status: 'pending',
                isVisible: false,
                isInvisibleSince: performance.now(),
            };
            this.patchesStore[patchId.asString] = storedPatch;
        }
        return storedPatch;
    }
}

export {
    EComputationMethod,
    VoxelmapViewer,
    type ComputationOptions,
    type ComputationStatus,
    type VoxelmapViewerOptions,
    type VoxelsChunkData,
};
