import { PromisesQueue } from '../../../../helpers/async/promises-queue';
import { logger } from '../../../../helpers/logger';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../libs/three-usage';
import { type MaterialsStore } from '../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../i-voxelmap';
import { PatchFactoryCpu } from '../../patch/patch-factory/merged/patch-factory-cpu';
import { PatchFactoryCpuWorker } from '../../patch/patch-factory/merged/patch-factory-cpu-worker';
import { PatchFactoryGpuSequential } from '../../patch/patch-factory/merged/patch-factory-gpu-sequential';
import { type PatchFactoryBase } from '../../patch/patch-factory/patch-factory-base';
import { PatchId } from '../../patch/patch-id';
import { type CheckerboardType, type VoxelsChunkData } from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { VoxelmapViewerBase, type ComputedPatch, type PatchRenderable } from '../voxelmap-viewer-base';

import { EComputationResult, StoredPatch, type AdaptativeQualityParameters } from './stored-patch';

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
    readonly patchSize?: VoxelsChunkSize;
    readonly computationOptions?: ComputationOptions;
    readonly checkerboardType?: CheckerboardType;
    readonly voxelsChunkOrdering?: VoxelsChunkOrdering;
};

class VoxelmapViewer extends VoxelmapViewerBase {
    public readonly computationOptions: ComputationOptions;
    public readonly maxPatchesComputedInParallel: number;

    private readonly promiseThrottler: PromisesQueue;
    private readonly patchFactory: PatchFactoryBase;

    private readonly storedPatches = new Map<string, StoredPatch>();

    private readonly transitionTime: number;

    public constructor(minChunkIdY: number, maxChunkIdY: number, voxelMaterialsStore: MaterialsStore, options?: VoxelmapViewerOptions) {
        const patchSize = options?.patchSize ?? { xz: 64, y: 64 };
        super(minChunkIdY, maxChunkIdY, patchSize);

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
            this.patchFactory = new PatchFactoryCpu({
                voxelMaterialsStore,
                patchSize,
                checkerboardType,
                greedyMeshing: this.computationOptions.greedyMeshing ?? true,
                voxelsChunkOrdering,
            });
            this.maxPatchesComputedInParallel = 1;
        } else if (this.computationOptions.method === EComputationMethod.CPU_MULTITHREADED) {
            this.patchFactory = new PatchFactoryCpuWorker({
                voxelMaterialsStore,
                patchSize,
                workersPoolSize: this.computationOptions.threadsCount,
                checkerboardType,
                greedyMeshing: this.computationOptions.greedyMeshing ?? true,
                voxelsChunkOrdering,
            });
            this.maxPatchesComputedInParallel = this.computationOptions.threadsCount;
        } else {
            this.patchFactory = new PatchFactoryGpuSequential({
                voxelMaterialsStore,
                patchSize,
                voxelsChunkOrdering,
                checkerboardType,
            });
            this.maxPatchesComputedInParallel = 1;
        }

        this.promiseThrottler = new PromisesQueue(this.maxPatchesComputedInParallel);

        this.transitionTime = options?.transitionTime ?? 250;
    }

    public override update(): void {
        for (const storedPatch of this.storedPatches.values()) {
            storedPatch.update();
        }

        super.update();
    }

    public doesPatchRequireVoxelsData(id: THREE.Vector3Like): boolean {
        const patchId = new PatchId(id);
        const storedPatch = this.storedPatches.get(patchId.asString);
        return !storedPatch || storedPatch.needsNewData();
    }

    public async enqueuePatch(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<EComputationResult> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.patchSize)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}.`);
        }

        const patchId = new PatchId(id);
        let storedPatch = this.storedPatches.get(patchId.asString);
        if (!storedPatch) {
            storedPatch = new StoredPatch({ parent: this.container, id: patchId, transitionTime: this.transitionTime });
            storedPatch.onVisibilityChange.push(() => this.notifyChange());
            this.storedPatches.set(patchId.asString, storedPatch);
        }
        if (!storedPatch.needsNewData()) {
            logger.debug(`Skipping unnecessary computation of up-do-date patch "${patchId.asString}".`);
            return Promise.resolve(EComputationResult.SKIPPED);
        }

        const computationTask = async () => {
            if (voxelsChunkData.isEmpty) {
                return null;
            }
            const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
            const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);
            return await this.patchFactory.buildPatchFromVoxelsChunk(patchId, patchStart, patchEnd, voxelsChunkData);
        };

        return storedPatch.scheduleNewComputation(computationTask, this.promiseThrottler);
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
    }

    public dequeuePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);
        const storedPatch = this.storedPatches.get(patchId.asString);
        storedPatch?.cancelScheduledComputation();
    }

    public invalidatePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);
        const storedPatch = this.storedPatches.get(patchId.asString);
        storedPatch?.flagAsObsolete();
    }

    public deletePatch(id: THREE.Vector3Like): void {
        const patchId = new PatchId(id);
        const storedPatch = this.storedPatches.get(patchId.asString);
        if (storedPatch) {
            storedPatch.cancelScheduledComputation();
            storedPatch.deleteComputationResults();
        }
    }

    public setVisibility(visiblePatchesId: ReadonlyArray<THREE.Vector3Like>): void {
        const visiblePatchesIdsSet = new Set<string>();
        for (const visiblePatchId of visiblePatchesId) {
            const patchId = new PatchId(visiblePatchId);
            visiblePatchesIdsSet.add(patchId.asString);

            if (!this.storedPatches.has(patchId.asString)) {
                this.storedPatches.set(
                    patchId.asString,
                    new StoredPatch({ parent: this.container, id: patchId, transitionTime: this.transitionTime })
                );
            }
        }

        for (const [patchId, storedPatch] of this.storedPatches.entries()) {
            const shouldBeVisible = visiblePatchesIdsSet.has(patchId);
            storedPatch.setVisible(shouldBeVisible);
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

    public setAdaptativeQuality(parameters: AdaptativeQualityParameters): void {
        for (const storedPatch of this.storedPatches.values()) {
            storedPatch.updateDisplayQuality(parameters);
        }
    }

    protected override get allLoadedPatches(): ComputedPatch[] {
        const result: ComputedPatch[] = [];
        for (const storedPatch of this.storedPatches.values()) {
            const voxelsRenderable = storedPatch.tryGetVoxelsRenderable();
            if (voxelsRenderable)
                result.push({
                    isVisible: storedPatch.isMeshInScene(),
                    voxelsRenderable,
                });
        }
        return result;
    }

    protected override get allVisiblePatches(): PatchRenderable[] {
        const result: PatchRenderable[] = [];

        for (const storedPatch of this.storedPatches.values()) {
            const voxelsRenderable = storedPatch.tryGetVoxelsRenderable();
            if (voxelsRenderable && storedPatch.isMeshInScene()) {
                result.push({ id: storedPatch.id, voxelsRenderable });
            }
        }

        return result;
    }

    protected override isPatchAttached(patchId: PatchId): boolean {
        const storedPatch = this.storedPatches.get(patchId.asString);
        if (storedPatch) {
            return storedPatch.isAttached();
        }
        return false;
    }

    protected override garbageCollectPatches(maxInvisiblePatchesInPatch: number): void {
        type InvisiblePatch = {
            readonly storedPatch: StoredPatch;
            readonly invisibleSinceTimestamp: number;
        };

        const invisiblePatchesList: InvisiblePatch[] = [];
        for (const storedPatch of this.storedPatches.values()) {
            const invisibleSinceTimestamp = storedPatch.isDetachedSince();
            if (invisibleSinceTimestamp !== null) {
                invisiblePatchesList.push({ storedPatch, invisibleSinceTimestamp });
            }
        }
        // oldest last
        invisiblePatchesList.sort((ip1: InvisiblePatch, ip2: InvisiblePatch) => ip2.invisibleSinceTimestamp - ip1.invisibleSinceTimestamp);

        let nextPatchToDelete = invisiblePatchesList.pop();
        while (nextPatchToDelete && invisiblePatchesList.length > maxInvisiblePatchesInPatch) {
            nextPatchToDelete.storedPatch.dispose();
            this.storedPatches.delete(nextPatchToDelete.storedPatch.id.asString);

            nextPatchToDelete = invisiblePatchesList.pop();
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
