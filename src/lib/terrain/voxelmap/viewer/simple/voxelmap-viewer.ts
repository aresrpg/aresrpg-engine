import { DisposableMap } from '../../../../helpers/disposable-map';
import { PromisesQueue } from '../../../../helpers/async/promises-queue';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type VoxelsChunkSize, type IVoxelMaterial } from '../../i-voxelmap';
import { PatchFactoryGpuSequential } from '../../patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from '../../patch/patch-factory/patch-factory-base';
import { PatchId } from '../../patch/patch-id';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';
import { type VoxelsChunkData } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { VoxelmapViewerBase, type ComputedPatch, type PatchRenderable } from '../voxelmap-viewer-base';

type VoxelmapViewerOptions = {
    patchSize?: VoxelsChunkSize;
};

type ComputationStatus = 'success' | 'skipped' | 'aborted';

type StoredPatchRenderable = {
    readonly id: PatchId;
    isVisible: boolean;
    isInvisibleSince: number;
    computationTask:
        | {
              status: 'pending';
          }
        | {
              status: 'ongoing';
          }
        | {
              status: 'finished';
              readonly voxelsRenderable: VoxelsRenderable | null;
          }
        | null;
    dispose: VoidFunction;
};

class VoxelmapViewer extends VoxelmapViewerBase {
    private readonly promiseThrottler = new PromisesQueue(1);
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

        this.patchFactory = new PatchFactoryGpuSequential(voxelsMaterialsList, voxelsChunksSize);
    }

    public doesPatchRequireVoxelsData(id: THREE.Vector3Like): boolean {
        const patchId = new PatchId(id);
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        return !storedPatch || !storedPatch.computationTask;
    }

    public async enqueuePatch(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<ComputationStatus> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}`);
        }

        const patchId = new PatchId(id);
        const storedPatch = this.getOrBuildStoredPatch(patchId);
        if (storedPatch.computationTask) {
            // this patch is already registered for computation
            return Promise.resolve('skipped');
        }

        return new Promise<ComputationStatus>(resolve => {
            const resolveAsAborted = () => resolve('aborted');

            storedPatch.computationTask = { status: 'pending' };
            storedPatch.dispose = () => {
                storedPatch.computationTask = null;
                resolveAsAborted();
            };

            // console.log(`Patch ${patchId.asString} is now in "pending" status.`);

            const startComputation = async () => {
                let computationStatus = storedPatch.computationTask?.status;
                if (computationStatus === 'pending') {
                    storedPatch.computationTask = { status: 'ongoing' };
                    storedPatch.dispose = () => {
                        throw new Error(`Patch ${patchId.asString} cannot be disposed during its computation.`);
                    };

                    // console.log(`Patch ${patchId.asString} is now in "ongoing" status.`);
                } else {
                    if (!storedPatch.computationTask) {
                        console.log(`Patch ${patchId.asString} has been aborted while in "pending" status. Don't compute.`);
                        return;
                    }
                    throw new Error(`Cannot compute patch ${patchId.asString} with status "${computationStatus}".`);
                }

                const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
                const voxelsRenderable = await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);

                computationStatus = storedPatch.computationTask?.status;
                if (computationStatus === 'ongoing') {
                    storedPatch.computationTask = {
                        status: 'finished',
                        voxelsRenderable,
                    };
                    storedPatch.dispose = () => {
                        if (voxelsRenderable) {
                            const container = voxelsRenderable.container;
                            if (container.parent) {
                                container.parent.remove(container);
                            }
                            voxelsRenderable.dispose();
                        }
                    };

                    // console.log(`Patch ${patchId.asString} is now in "finished" status.`);

                    if (voxelsRenderable && storedPatch.isVisible) {
                        this.container.add(voxelsRenderable.container);
                    }

                    resolve('success');
                } else {
                    throw new Error(`Cannot store computed patch ${patchId.asString} with status "${computationStatus}".`);
                }
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
        if (storedPatch?.computationTask?.status === 'pending') {
            storedPatch.dispose();
        }
    }

    public setVisibility(visiblePatchesId: ReadonlyArray<THREE.Vector3Like>): void {
        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible) {
                storedPatch.isVisible = false;
                storedPatch.isInvisibleSince = performance.now();
                if (storedPatch.computationTask?.status === 'finished' && storedPatch.computationTask.voxelsRenderable) {
                    this.container.remove(storedPatch.computationTask.voxelsRenderable.container);
                }
            }
        }

        for (const id of visiblePatchesId) {
            const visiblePatchId = new PatchId(id);
            const storedPatch = this.patchesStore.getItem(visiblePatchId.asString);
            if (storedPatch) {
                if (!storedPatch.isVisible) {
                    storedPatch.isVisible = true;
                    if (storedPatch.computationTask?.status === 'finished' && storedPatch.computationTask.voxelsRenderable) {
                        this.container.add(storedPatch.computationTask.voxelsRenderable.container);
                    }
                }
            } else {
                this.patchesStore.setItem(visiblePatchId.asString, {
                    id: visiblePatchId,
                    isVisible: true,
                    isInvisibleSince: performance.now(),
                    computationTask: null,
                    dispose: () => {},
                });
            }
        }
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
            if (patch.computationTask?.status === 'finished' && patch.computationTask.voxelsRenderable) {
                result.push({
                    isVisible: patch.isVisible,
                    voxelsRenderable: patch.computationTask.voxelsRenderable,
                });
            }
        }
        return result;
    }

    protected override get allVisiblePatches(): PatchRenderable[] {
        const result: PatchRenderable[] = [];

        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible && storedPatch.computationTask?.status === 'finished' && storedPatch.computationTask.voxelsRenderable) {
                result.push({ id: storedPatch.id, voxelsRenderable: storedPatch.computationTask.voxelsRenderable });
            }
        }

        return result;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        return !!storedPatch && storedPatch.isVisible && storedPatch.computationTask?.status === 'finished';
    }

    protected override garbageCollectPatches(maxInvisiblePatchesInPatch: number): void {
        const storedPatchesList = this.patchesStore.allItems;
        const elligibleStoredPatchesList = storedPatchesList.filter(storedPatch => {
            return !storedPatch.isVisible && storedPatch.computationTask?.status !== 'ongoing';
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
}

export { VoxelmapViewer, type ComputationStatus, type VoxelmapViewerOptions, type VoxelsChunkData };
