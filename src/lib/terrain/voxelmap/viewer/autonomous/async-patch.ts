import type * as THREE from '../../../../libs/three-usage';
import { type PatchId } from '../../patch/patch-id';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';

class AsyncPatch {
    private data:
        | {
              readonly state: 'pending';
              readonly promise: Promise<VoxelsRenderable | null>;
              visible: boolean;
              disposed: boolean;
          }
        | {
              readonly state: 'ready';
              readonly renderable: VoxelsRenderable | null;
              visible: boolean;
              disposed: boolean;
          };

    public readonly id: PatchId;
    private invisibilityTimestamp = performance.now();

    public constructor(container: THREE.Object3D, promise: Promise<VoxelsRenderable | null>, id: PatchId) {
        this.data = {
            state: 'pending',
            promise,
            visible: false,
            disposed: false,
        };

        this.id = id;

        promise.then((voxelsRenderable: VoxelsRenderable | null) => {
            if (this.data.state !== 'pending') {
                throw new Error();
            }

            this.data = {
                state: 'ready',
                renderable: voxelsRenderable,
                visible: this.data.visible,
                disposed: this.data.disposed,
            };

            if (this.data.renderable) {
                if (this.data.disposed) {
                    // disposal has been asked before the computation ended
                    this.data.renderable.dispose();
                } else {
                    this.data.renderable.container.visible = this.data.visible;
                    container.add(this.data.renderable.container);
                }
            }
        });
    }

    public get visible(): boolean {
        return this.data.visible;
    }

    public set visible(value: boolean) {
        if (this.visible === value) {
            return; // nothing to do
        }

        if (!value) {
            this.invisibilityTimestamp = performance.now();
        }

        this.data.visible = value;
        if (this.data.state === 'ready' && this.data.renderable) {
            this.data.renderable.container.visible = value;
        }
    }

    public get renderable(): VoxelsRenderable | null {
        if (this.data.state === 'ready') {
            return this.data.renderable;
        }
        return null;
    }

    public get invisibleSince(): number {
        return this.invisibilityTimestamp;
    }

    public dispose(): void {
        if (!this.data.disposed) {
            this.data.disposed = true;
            this.renderable?.dispose();
        }
    }

    public hasVisibleMesh(): boolean {
        return this.data.state === 'ready' && this.visible && !!this.data.renderable;
    }

    public get isReady(): boolean {
        return this.data.state === 'ready';
    }

    public async ready(): Promise<void> {
        if (this.data.state === 'pending') {
            await this.data.promise;
        }
    }
}

export { AsyncPatch };
