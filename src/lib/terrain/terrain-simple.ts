import { DisposableMap } from '../helpers/disposable-map';
import { PromiseThrottler } from '../helpers/promise-throttler';
import { vec3ToString } from '../helpers/string';
import * as THREE from '../three-usage';
import { IHeightmap } from './heightmap/i-heightmap';
import { IVoxelMap } from './terrain';
import { PatchRenderable, TerrainBase } from './terrain-base';
import { PatchFactoryGpuSequential } from './voxelmap/patch/patch-factory/merged/patch-factory-gpu-sequential';
import { PatchFactoryBase } from './voxelmap/patch/patch-factory/patch-factory-base';
import { PatchId } from './voxelmap/patch/patch-id';
import { VoxelsRenderable } from './voxelmap/voxelsRenderable/voxels-renderable';
import { VoxelsChunkData } from './voxelmap/voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

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
              status: 'started';
          }
        | {
              status: 'finished';
              readonly voxelsRenderable: VoxelsRenderable | null;
          }
        | null;
    dispose: VoidFunction;
};

class TerrainSimple extends TerrainBase {
    private readonly promiseThrottler = new PromiseThrottler(3);
    private readonly patchFactory: PatchFactoryBase;

    private readonly maxInvisiblePatchesInCache = 200;
    private patchesStore = new DisposableMap<StoredPatchRenderable>();

    public constructor(map: IVoxelMap & IHeightmap) {
        let voxelsChunksSize = { xz: 64, y: 64 };
        super(map, voxelsChunksSize);

        this.patchFactory = new PatchFactoryGpuSequential(map, voxelsChunksSize);
    }

    public async enqueuePatch(patchId: PatchId, voxelsChunkData: VoxelsChunkData): Promise<ComputationStatus> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}`);
        }

        const storedPatch = this.patchesStore.getItem(patchId.asString);
        if (storedPatch?.computation) {
            // this patch is already registered for computation
            return Promise.resolve('skipped');
        }

        return new Promise<ComputationStatus>(resolve => {
            const onAbort = () => resolve('aborted');

            {
                let storedPatch = this.patchesStore.getItem(patchId.asString);
                if (storedPatch) {
                    if (storedPatch.computation) {
                        throw new Error(`Patch ${patchId.asString} is already registered for computation.`);
                    }
                } else {
                    storedPatch = {
                        id: patchId,
                        isVisible: false,
                        isInvisibleSince: performance.now(),
                        computation: null,
                        dispose: () => {},
                    };
                    this.patchesStore.setItem(patchId.asString, storedPatch);
                }

                storedPatch.computation = {
                    status: 'pending',
                };
                storedPatch.dispose = () => {
                    storedPatch.computation = null;
                    onAbort();
                };
            }

            const startComputation = async () => {
                {
                    const storedPatch = this.patchesStore.getItem(patchId.asString);
                    if (!storedPatch) {
                        // this patch has been garbage collected before its computation started
                        return;
                    }
                    if (storedPatch.computation?.status !== 'pending') {
                        throw new Error(`Cannot compute patch ${patchId.asString} with status "${storedPatch.computation?.status}".`);
                    }
                    storedPatch.computation = { status: 'started' };
                    storedPatch.dispose = () => {
                        throw new Error(`Patch ${patchId.asString} cannot be disposed during its computation.`);
                    };
                }

                const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
                const voxelsRenderable = await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);

                {
                    const storedPatch = this.patchesStore.getItem(patchId.asString);
                    if (!storedPatch) {
                        // this patch has been garbage collected before its computation started
                        throw new Error(`Cannot store unknown computed patch ${patchId.asString}.`);
                    }
                    const status = storedPatch.computation?.status;
                    if (status !== 'started') {
                        throw new Error(`Cannot store computed patch ${patchId.asString} with status "${status}".`);
                    }
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
                }
            };

            this.promiseThrottler.run(startComputation, onAbort);
        });
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
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
        throw new Error('Not implemented');
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

    private garbageCollectPatches(): void {
        const storedPatches = this.patchesStore.allItems;
        const invisiblePatches = storedPatches.filter(storedPatch => !storedPatch.isVisible);
        invisiblePatches.sort((patch1, patch2) => patch1.isInvisibleSince - patch2.isInvisibleSince);

        while (invisiblePatches.length > this.maxInvisiblePatchesInCache) {
            const nextPatchToDelete = invisiblePatches.shift();
            if (!nextPatchToDelete) {
                break;
            }
            this.patchesStore.deleteItem(nextPatchToDelete.id.asString);
        }
    }
}

export { TerrainSimple };
