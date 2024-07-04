import { DisposableMap } from '../helpers/disposable-map';
import { PromiseThrottler } from '../helpers/promise-throttler';
import { vec3ToString } from '../helpers/string';
import * as THREE from '../three-usage';

import { type IHeightmap } from './heightmap/i-heightmap';
import { type VoxelsChunkSize } from './terrain';
import { TerrainBase, type PatchRenderable } from './terrain-base';
import { type IVoxelMaterial } from './voxelmap/i-voxelmap';
import { PatchFactoryGpuSequential } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from './voxelmap/patch/patch-factory/patch-factory-base';
import { type PatchId } from './voxelmap/patch/patch-id';
import { type VoxelsRenderable } from './voxelmap/voxelsRenderable/voxels-renderable';
import { type VoxelsChunkData } from './voxelmap/voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

type TerrainSimpleOptions = {
    patchSize?: VoxelsChunkSize;
};

type ComputationStatus = 'success' | 'skipped' | 'aborted';

type StoredPatchRenderable = {
    readonly id: PatchId;
    isVisible: boolean;
    isInvisibleSince: number;
    computation:
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

class TerrainSimple extends TerrainBase {
    private readonly promiseThrottler = new PromiseThrottler(1);
    private readonly patchFactory: PatchFactoryBase;

    private readonly maxInvisiblePatchesInCache = 200;
    private patchesStore = new DisposableMap<StoredPatchRenderable>();

    private garbageCollectionHandle: number | null;

    public constructor(map: IHeightmap, voxelsMaterialsList: ReadonlyArray<IVoxelMaterial>, options?: TerrainSimpleOptions) {
        let voxelsChunksSize = { xz: 64, y: 64 };
        if (options?.patchSize) {
            voxelsChunksSize = options.patchSize;
        }

        super(map, voxelsChunksSize);

        this.patchFactory = new PatchFactoryGpuSequential(voxelsMaterialsList, voxelsChunksSize);

        this.garbageCollectionHandle = window.setInterval(() => this.garbageCollectPatches(), 5000);
    }

    public canPatchBeEnqueued(id: PatchId): boolean {
        const storedPatch = this.patchesStore.getItem(id.asString);
        return !storedPatch || !storedPatch.computation;
    }

    public async enqueuePatch(patchId: PatchId, voxelsChunkData: VoxelsChunkData): Promise<ComputationStatus> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}`);
        }

        const storedPatch = this.getOrBuildStoredPatch(patchId);
        if (storedPatch.computation) {
            // this patch is already registered for computation
            return Promise.resolve('skipped');
        }

        return new Promise<ComputationStatus>(resolve => {
            const resolveAsAborted = () => resolve('aborted');

            storedPatch.computation = { status: 'pending' };
            storedPatch.dispose = () => {
                storedPatch.computation = null;
                resolveAsAborted();
            };

            // console.log(`Patch ${patchId.asString} is now in "pending" status.`);

            const startComputation = async () => {
                let computationStatus = storedPatch.computation?.status;
                if (computationStatus === 'pending') {
                    storedPatch.computation = { status: 'ongoing' };
                    storedPatch.dispose = () => {
                        throw new Error(`Patch ${patchId.asString} cannot be disposed during its computation.`);
                    };

                    // console.log(`Patch ${patchId.asString} is now in "ongoing" status.`);
                } else {
                    if (!storedPatch.computation) {
                        console.log(`Patch ${patchId.asString} has been aborted while in "pending" status. Don't compute.`);
                        return;
                    }
                    throw new Error(`Cannot compute patch ${patchId.asString} with status "${computationStatus}".`);
                }

                const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
                const voxelsRenderable = await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);

                computationStatus = storedPatch.computation?.status;
                if (computationStatus === 'ongoing') {
                    storedPatch.computation = {
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
                        this.patchesContainer.add(voxelsRenderable.container);
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

    public dequeuePatch(patchId: PatchId): void {
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        if (storedPatch?.computation?.status === 'pending') {
            storedPatch.dispose();
        }
    }

    public setVisibility(visiblePatchesId: ReadonlyArray<PatchId>): void {
        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible) {
                storedPatch.isVisible = false;
                storedPatch.isInvisibleSince = performance.now();
                if (storedPatch.computation?.status === 'finished' && storedPatch.computation.voxelsRenderable) {
                    this.patchesContainer.remove(storedPatch.computation.voxelsRenderable.container);
                }
            }
        }

        for (const visiblePatchId of visiblePatchesId) {
            const storedPatch = this.patchesStore.getItem(visiblePatchId.asString);
            if (storedPatch) {
                if (!storedPatch.isVisible) {
                    storedPatch.isVisible = true;
                    if (storedPatch.computation?.status === 'finished' && storedPatch.computation.voxelsRenderable) {
                        this.patchesContainer.add(storedPatch.computation.voxelsRenderable.container);
                    }
                }
            } else {
                this.patchesStore.setItem(visiblePatchId.asString, {
                    id: visiblePatchId,
                    isVisible: true,
                    isInvisibleSince: performance.now(),
                    computation: null,
                    dispose: () => {},
                });
            }
        }
    }

    public dispose(): void {
        if (this.garbageCollectionHandle) {
            clearInterval(this.garbageCollectionHandle);
            this.garbageCollectionHandle = null;
        }
        throw new Error('Not implemented');
    }

    public getVoxelsChunkBox(patchId: PatchId): THREE.Box3 {
        const voxelFrom = new THREE.Vector3().multiplyVectors(patchId, this.patchSize).subScalar(1);
        const voxelTo = voxelFrom.clone().add(this.patchSize).addScalar(2);
        return new THREE.Box3(voxelFrom, voxelTo);
    }

    protected get allVisiblePatches(): PatchRenderable[] {
        const result: PatchRenderable[] = [];

        for (const storedPatch of this.patchesStore.allItems) {
            if (storedPatch.isVisible && storedPatch.computation?.status === 'finished' && storedPatch.computation.voxelsRenderable) {
                result.push({ id: storedPatch.id, voxelsRenderable: storedPatch.computation.voxelsRenderable });
            }
        }

        return result;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const storedPatch = this.patchesStore.getItem(patchId.asString);
        return !!storedPatch && storedPatch.isVisible && storedPatch.computation?.status === 'finished';
    }

    private getOrBuildStoredPatch(patchId: PatchId): StoredPatchRenderable {
        let storedPatch = this.patchesStore.getItem(patchId.asString);
        if (!storedPatch) {
            storedPatch = {
                id: patchId,
                isVisible: false,
                isInvisibleSince: performance.now(),
                computation: null,
                dispose: () => {},
            };
            this.patchesStore.setItem(patchId.asString, storedPatch);
        }
        return storedPatch;
    }

    private garbageCollectPatches(): void {
        const storedPatchesList = this.patchesStore.allItems;
        const elligibleStoredPatchesList = storedPatchesList.filter(storedPatch => {
            return !storedPatch.isVisible && storedPatch.computation?.status !== 'ongoing';
        });
        elligibleStoredPatchesList.sort((patch1, patch2) => patch1.isInvisibleSince - patch2.isInvisibleSince);

        while (elligibleStoredPatchesList.length > this.maxInvisiblePatchesInCache) {
            const nextPatchToDelete = elligibleStoredPatchesList.shift();
            if (!nextPatchToDelete) {
                break;
            }
            this.patchesStore.deleteItem(nextPatchToDelete.id.asString);
        }
    }
}

export { TerrainSimple };
