import { AsyncTask } from '../../../../helpers/async/async-task';
import { PromisesQueue } from '../../../../helpers/async/promises-queue';
import { DisposableMap } from '../../../../helpers/disposable-map';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type IVoxelMaterial, type VoxelsChunkSize } from '../../i-voxelmap';
import { PatchFactoryCpu } from '../../patch/patch-factory/merged/patch-factory-cpu';
import { PatchFactoryCpuWorker } from '../../patch/patch-factory/merged/patch-factory-cpu-worker';
import { PatchFactoryGpuSequential } from '../../patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from '../../patch/patch-factory/patch-factory-base';
import { PatchId } from '../../patch/patch-id';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';
import { type VoxelsChunkData } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
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
};

type ComputationStatus = 'success' | 'skipped' | 'aborted';

type StoredPatchRenderable = {
    readonly id: PatchId;
    isVisible: boolean;
    isInvisibleSince: number;
    computationTask: AsyncTask<VoxelsRenderable | null> | null;
    dispose: VoidFunction;
};

class VoxelmapViewer extends VoxelmapViewerBase {
    public readonly computationOptions: ComputationOptions;
    public readonly maxPatchesComputedInParallel: number;

    private readonly promiseThrottler: PromisesQueue;
    private readonly patchFactory: PatchFactoryBase;

    private patchesStore = new DisposableMap<StoredPatchRenderable>();

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

        if (this.computationOptions.method === EComputationMethod.CPU_MONOTHREADED) {
            this.patchFactory = new PatchFactoryCpu(voxelsMaterialsList, voxelsChunksSize);
            this.maxPatchesComputedInParallel = 1;
        } else if (this.computationOptions.method === EComputationMethod.CPU_MULTITHREADED) {
            this.patchFactory = new PatchFactoryCpuWorker(voxelsMaterialsList, voxelsChunksSize, this.computationOptions.threadsCount);
            this.maxPatchesComputedInParallel = this.computationOptions.threadsCount;
        } else {
            this.patchFactory = new PatchFactoryGpuSequential(voxelsMaterialsList, voxelsChunksSize);
            this.maxPatchesComputedInParallel = 1;
        }

        this.promiseThrottler = new PromisesQueue(this.maxPatchesComputedInParallel);
    }

    public doesPatchRequireVoxelsData(id: THREE.Vector3Like): boolean {
        const patchId = new PatchId(id);
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        return !storedPatch || !storedPatch.computationTask;
    }

    public async enqueuePatch(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<ComputationStatus> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}.`);
        }

        const patchId = new PatchId(id);
        const storedPatch = this.getOrBuildStoredPatch(patchId);
        if (storedPatch.computationTask) {
            // this patch is already in queue for computation
            return Promise.resolve('skipped');
        }

        return new Promise<ComputationStatus>(resolve => {
            const resolveAsAborted = () => resolve('aborted');

            storedPatch.computationTask = new AsyncTask<VoxelsRenderable | null>(async () => {
                const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
                return await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);
            });
            storedPatch.dispose = () => {
                storedPatch.computationTask = null;
                resolveAsAborted();
            };

            const startComputation = async () => {
                if (!storedPatch.computationTask) {
                    // console.log(`Patch ${patchId.asString} has been aborted while in "pending" status. Don't compute.`);
                    return;
                }

                const voxelsRenderable = await storedPatch.computationTask.start();
                if (voxelsRenderable && storedPatch.isVisible) {
                    this.container.add(voxelsRenderable.container);
                    this.notifyChange();
                }

                storedPatch.dispose = () => {
                    if (voxelsRenderable) {
                        const container = voxelsRenderable.container;
                        if (container.parent) {
                            container.parent.remove(container);
                            this.notifyChange();
                        }
                        voxelsRenderable.dispose();
                    }
                };

                resolve('success');
            };

            this.promiseThrottler.run(startComputation, resolveAsAborted);
        });
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
    }

    public dequeuePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        if (storedPatch && storedPatch.computationTask?.isStarted !== true) {
            storedPatch.dispose();
        }
    }

    public setVisibility(visiblePatchesId: ReadonlyArray<THREE.Vector3Like>): void {
        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible) {
                storedPatch.isVisible = false;
                storedPatch.isInvisibleSince = performance.now();
                const voxelsRenderable = this.tryGetVoxelsRenderable(storedPatch);
                if (voxelsRenderable) {
                    this.container.remove(voxelsRenderable.container);
                }
            }
        }

        for (const id of visiblePatchesId) {
            const visiblePatchId = new PatchId(id);
            const storedPatch = this.getOrBuildStoredPatch(visiblePatchId);
            if (!storedPatch.isVisible) {
                storedPatch.isVisible = true;
                storedPatch.isInvisibleSince = -1;
                const voxelsRenderable = this.tryGetVoxelsRenderable(storedPatch);
                if (voxelsRenderable) {
                    this.container.add(voxelsRenderable.container);
                }
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
        for (const patch of this.patchesStore.allItems) {
            const voxelsRenderable = this.tryGetVoxelsRenderable(patch);
            if (voxelsRenderable) {
                result.push({
                    isVisible: patch.isVisible,
                    voxelsRenderable,
                });
            }
        }
        return result;
    }

    protected override get allVisiblePatches(): PatchRenderable[] {
        const result: PatchRenderable[] = [];

        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible) {
                const voxelsRenderable = this.tryGetVoxelsRenderable(storedPatch);
                if (voxelsRenderable) {
                    result.push({ id: storedPatch.id, voxelsRenderable });
                }
            }
        }

        return result;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        return !!storedPatch && storedPatch.isVisible && storedPatch.computationTask?.isFinished === true;
    }

    protected override garbageCollectPatches(maxInvisiblePatchesInPatch: number): void {
        const storedPatchesList = this.patchesStore.allItems;
        const elligibleStoredPatchesList = storedPatchesList.filter(storedPatch => {
            return !storedPatch.isVisible && !storedPatch.computationTask?.isRunning;
        });
        elligibleStoredPatchesList.sort((patch1, patch2) => patch1.isInvisibleSince - patch2.isInvisibleSince);

        while (elligibleStoredPatchesList.length > maxInvisiblePatchesInPatch) {
            const nextPatchToDelete = elligibleStoredPatchesList.shift();
            if (!nextPatchToDelete) {
                break;
            }
            this.patchesStore.deleteItem(nextPatchToDelete.id.asString);
        }
    }

    private getOrBuildStoredPatch(patchId: PatchId): StoredPatchRenderable {
        let storedPatch = this.patchesStore.getItem(patchId.asString);
        if (!storedPatch) {
            storedPatch = {
                id: patchId,
                isVisible: false,
                isInvisibleSince: performance.now(),
                computationTask: null,
                dispose: () => {},
            };
            this.patchesStore.setItem(patchId.asString, storedPatch);
        }
        return storedPatch;
    }

    private tryGetVoxelsRenderable(storedPatch: StoredPatchRenderable): VoxelsRenderable | null {
        if (storedPatch.computationTask?.isFinished) {
            return storedPatch.computationTask.getResultSync();
        }
        return null;
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
