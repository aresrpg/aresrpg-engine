import type * as THREE from '../../../../libs/three-usage';
import { type PatchId } from '../../patch/patch-id';
import { EVoxelMaterialQuality } from '../../voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';

enum EComputationResult {
    SKIPPED = 'skipped',
    CANCELLED = 'cancelled',
    FINISHED = 'finished',
}

type UnknownFunc = () => unknown;
type AsyncTask<T> = () => Promise<T>;
type TaskRunner = {
    run(task: UnknownFunc, onCancel: UnknownFunc): Promise<unknown>;
};

type AdaptativeQualityParameters = {
    readonly distanceThreshold: number;
    readonly cameraPosition: THREE.Vector3;
};

class StoredPatch {
    public readonly id: PatchId;
    private readonly parent: THREE.Object3D;

    private hasLatestData: boolean = false; // TODO à travailler
    private latestComputationId: Symbol | null = null;
    private voxelsRenderable: VoxelsRenderable | null = null;

    private disposed: boolean = false;
    private shouldBeVisible: boolean = false;
    private invisibleSince: number | null = performance.now();

    private latestAdaptativeQualityParameters: AdaptativeQualityParameters | null = null;

    public constructor(parent: THREE.Object3D, id: PatchId) {
        this.parent = parent;
        this.id = id;
    }

    public needsNewData(): boolean {
        return !this.hasLatestData;
    }

    public flagAsObsolete(): void {
        this.hasLatestData = false;
    }

    public setVisible(visible: boolean): void {
        if (this.shouldBeVisible !== visible) {
            this.shouldBeVisible = visible;

            if (this.shouldBeVisible) {
                this.invisibleSince = null;
            } else {
                this.invisibleSince = performance.now();
            }

            if (this.voxelsRenderable) {
                if (this.shouldBeVisible) {
                    this.parent.add(this.voxelsRenderable.container);
                } else {
                    this.voxelsRenderable.container.removeFromParent();
                }
            }
        }
    }

    public getInvisibleSinceTimestamp(): number | null {
        return this.invisibleSince;
    }

    public isMeshInScene(): boolean {
        return !!this.voxelsRenderable?.container.parent;
    }

    public tryGetVoxelsRenderable(): VoxelsRenderable | null {
        return this.voxelsRenderable;
    }

    public updateDisplayQuality(params: AdaptativeQualityParameters | null): void {
        this.latestAdaptativeQualityParameters = params;

        if (this.voxelsRenderable) {
            StoredPatch.enforceDisplayQuality(this.voxelsRenderable, this.latestAdaptativeQualityParameters);
        }
    }

    public scheduleNewComputation(
        computationTask: AsyncTask<VoxelsRenderable | null>,
        taskRunner: TaskRunner
    ): Promise<EComputationResult> {
        if (this.disposed) {
            throw new Error(`Cannot compute disposed patch "${this.id.asString}".`);
        }

        const computationId = Symbol('stored-patch-computation');
        this.latestComputationId = computationId;
        this.hasLatestData = true;

        return new Promise<EComputationResult>(resolve => {
            const resolveAsCancelled = () => resolve(EComputationResult.CANCELLED);
            const resolveAsFinished = () => resolve(EComputationResult.FINISHED);

            taskRunner.run(async () => {
                if (computationId !== this.latestComputationId) {
                    // a more recent computation has been requested before this one started
                    resolveAsCancelled();
                    return;
                }

                const computationResult = await computationTask();

                if (computationId !== this.latestComputationId) {
                    // a more recent computation has been requested while this one was running
                    if (computationResult) {
                        computationResult.dispose();
                    }
                    resolveAsCancelled();
                    return;
                }

                this.voxelsRenderable = computationResult;
                if (this.voxelsRenderable) {
                    StoredPatch.enforceDisplayQuality(this.voxelsRenderable, this.latestAdaptativeQualityParameters);
                    if (this.shouldBeVisible) {
                        this.parent.add(this.voxelsRenderable.container);
                    }
                }

                resolveAsFinished();
            }, resolveAsCancelled);
        });
    }

    public cancelScheduledComputation(): void {
        this.latestComputationId = null;
        this.hasLatestData = false;
    }

    public deleteComputationResults(): void {
        if (this.voxelsRenderable) {
            this.voxelsRenderable.container.removeFromParent();
            this.voxelsRenderable.dispose();
            this.voxelsRenderable = null;
            this.hasLatestData = false;
        }
    }

    public dispose(): void {
        if (this.disposed) {
            throw new Error(`Patch "${this.id.asString}" was disposed twice.`);
        }
        this.disposed = true;

        this.cancelScheduledComputation();
        this.deleteComputationResults();
    }

    private static enforceDisplayQuality(voxelsRenderable: VoxelsRenderable, params: AdaptativeQualityParameters | null): void {
        let quality = EVoxelMaterialQuality.HIGH;

        if (params) {
            const distance = voxelsRenderable.boundingBox.distanceToPoint(params.cameraPosition);
            if (distance > params.distanceThreshold) {
                quality = EVoxelMaterialQuality.LOW;
            }
        }

        voxelsRenderable.quality = quality;
    }
}

export { EComputationResult, StoredPatch, type AdaptativeQualityParameters };
