import { Transition } from '../../../helpers/transition';
import type * as THREE from '../../../libs/three-usage';
import { type ChunkId } from '../chunk/chunk-id';
import { EVoxelMaterialQuality } from '../voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';

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

type Parameters = {
    readonly parent: THREE.Object3D;
    readonly id: ChunkId;
    readonly transitionTime: number;
};

class AsyncChunkRenderable {
    public readonly id: ChunkId;
    public readonly onVisibilityChange: VoidFunction[] = [];

    private readonly transitionTime: number;
    private readonly parent: THREE.Object3D;

    private hasLatestData: boolean = false;
    private latestComputationId: Symbol | null = null;
    private computationResult: {
        readonly voxelsRenderable: VoxelsRenderable | null;
    } | null = null;

    private disposed: boolean = false;
    private shouldBeAttached: boolean = false;
    private detachedSince: number | null = performance.now();
    private transition: Transition | null = null;

    private latestAdaptativeQualityParameters: AdaptativeQualityParameters | null = null;

    public constructor(params: Parameters) {
        this.parent = params.parent;
        this.id = params.id;
        this.transitionTime = params.transitionTime;
    }

    public update(): void {
        const voxelRenderable = this.tryGetVoxelsRenderable();
        if (voxelRenderable) {
            if (this.transition) {
                const wasFullyVisible = voxelRenderable.parameters.dissolveRatio === 0;
                voxelRenderable.parameters.dissolveRatio = this.transition.currentValue;

                if (this.transition.isFinished()) {
                    this.transition = null;

                    if (!this.shouldBeAttached) {
                        voxelRenderable.container.removeFromParent();
                    }
                }

                const isFullyVisible = voxelRenderable.parameters.dissolveRatio === 0;
                if (wasFullyVisible !== isFullyVisible) {
                    this.notifyVisibilityChange();
                }
            }
        }
    }

    public needsNewData(): boolean {
        return !this.hasLatestData;
    }

    public flagAsObsolete(): void {
        this.hasLatestData = false;
    }

    public setVisible(visible: boolean): void {
        if (this.shouldBeAttached !== visible) {
            this.shouldBeAttached = visible;

            if (this.shouldBeAttached) {
                this.detachedSince = null;
            } else {
                this.detachedSince = performance.now();
            }

            const voxelsRenderable = this.tryGetVoxelsRenderable();
            if (voxelsRenderable) {
                if (this.shouldBeAttached) {
                    this.parent.add(voxelsRenderable.container);
                    this.transitionToDissolved(false);
                } else {
                    this.transitionToDissolved(true);
                }
            }
        }
    }

    public isDetachedSince(): number | null {
        return this.detachedSince;
    }

    public isMeshInScene(): boolean {
        return !!this.tryGetVoxelsRenderable()?.container.parent;
    }

    public isAttached(): boolean {
        if (!this.computationResult) {
            return false;
        }
        const voxelsRenderable = this.computationResult.voxelsRenderable;
        if (voxelsRenderable) {
            return !!voxelsRenderable.container.parent && voxelsRenderable.parameters.dissolveRatio === 0;
        } else {
            // the chunk was computed, but there is no mesh -> it is as if it was in the scene
            return true;
        }
    }

    public tryGetVoxelsRenderable(): VoxelsRenderable | null {
        if (this.computationResult) {
            return this.computationResult.voxelsRenderable;
        }
        return null;
    }

    public updateDisplayQuality(params: AdaptativeQualityParameters | null): void {
        this.latestAdaptativeQualityParameters = params;

        const voxelsRenerable = this.tryGetVoxelsRenderable();
        if (voxelsRenerable) {
            AsyncChunkRenderable.enforceDisplayQuality(voxelsRenerable, this.latestAdaptativeQualityParameters);
        }
    }

    public scheduleNewComputation(
        computationTask: AsyncTask<VoxelsRenderable | null>,
        taskRunner: TaskRunner
    ): Promise<EComputationResult> {
        if (this.disposed) {
            throw new Error(`Cannot compute disposed chunk "${this.id.asString}".`);
        }

        const computationId = Symbol('async-chunk-renderable-computation');
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

                const computedVoxelsRenderable = await computationTask();

                if (computationId !== this.latestComputationId) {
                    // a more recent computation has been requested while this one was running
                    if (computedVoxelsRenderable) {
                        computedVoxelsRenderable.dispose();
                    }
                    resolveAsCancelled();
                    return;
                }
                this.latestComputationId = null;

                const wasMeshInScene = this.isMeshInScene();

                if (this.computationResult) {
                    // we are overwriting a previous computation result
                    if (this.computationResult.voxelsRenderable) {
                        // properly remove the obsolete computation that we are overwriting
                        this.computationResult.voxelsRenderable.container.removeFromParent();
                        this.computationResult.voxelsRenderable.dispose();
                    }
                }

                this.computationResult = {
                    voxelsRenderable: computedVoxelsRenderable,
                };

                if (computedVoxelsRenderable) {
                    AsyncChunkRenderable.enforceDisplayQuality(computedVoxelsRenderable, this.latestAdaptativeQualityParameters);
                    if (this.shouldBeAttached) {
                        this.parent.add(computedVoxelsRenderable.container);

                        if (!wasMeshInScene) {
                            this.transitionToDissolved(false);
                        }
                    }
                }

                resolveAsFinished();
            }, resolveAsCancelled);
        });
    }

    public cancelScheduledComputation(): void {
        if (this.latestComputationId) {
            this.latestComputationId = null;
            this.hasLatestData = false;
        }
    }

    public deleteComputationResults(): void {
        if (this.computationResult) {
            const voxelsRenderable = this.tryGetVoxelsRenderable();
            if (voxelsRenderable) {
                voxelsRenderable.container.removeFromParent();
                voxelsRenderable.dispose();
            }
            this.computationResult = null;

            this.hasLatestData = false;
        }
    }

    public dispose(): void {
        if (this.disposed) {
            throw new Error(`AsyncChunkRenderable "${this.id.asString}" was disposed twice.`);
        }
        this.disposed = true;

        this.cancelScheduledComputation();
        this.deleteComputationResults();
    }

    private transitionToDissolved(dissolved: boolean): void {
        let from: number;
        if (this.transition) {
            from = this.transition.currentValue;
        } else {
            from = dissolved ? 0 : 1;
        }
        const to = dissolved ? 1 : 0;

        this.transition = new Transition(this.transitionTime * Math.abs(to - from), from, to);
    }

    private notifyVisibilityChange(): void {
        for (const callback of this.onVisibilityChange) {
            callback();
        }
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

export { AsyncChunkRenderable, EComputationResult, type AdaptativeQualityParameters };
