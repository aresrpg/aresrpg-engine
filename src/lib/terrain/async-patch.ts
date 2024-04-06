import { Patch } from './patch/patch';
import { PatchId} from "./patch/patch-id";

class AsyncPatch {
    private data:
        | {
              readonly state: 'pending';
              readonly promise: Promise<Patch | null>;
              visible: boolean;
              disposed: boolean;
          }
        | {
              readonly state: 'ready';
              readonly patch: Patch | null;
              visible: boolean;
              disposed: boolean;
          };

    public readonly id: PatchId;
    public readonly boundingBox: THREE.Box3;
    private invisibilityTimestamp = performance.now();

    public constructor(container: THREE.Object3D, promise: Promise<Patch | null>, id: PatchId, boundingBox: THREE.Box3) {
        this.data = {
            state: 'pending',
            promise,
            visible: false,
            disposed: false,
        };

        this.id = id;
        this.boundingBox = boundingBox;

        promise.then((patch: Patch | null) => {
            if (this.data.state !== 'pending') {
                throw new Error();
            }

            this.data = {
                state: 'ready',
                patch,
                visible: this.data.visible,
                disposed: this.data.disposed,
            };

            if (this.data.patch) {
                if (this.data.disposed) {
                    // disposal has been asked before the computation ended
                    this.data.patch.dispose();
                } else {
                    this.data.patch.container.visible = this.data.visible;
                    container.add(this.data.patch.container);
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
        if (this.data.state === 'ready' && this.data.patch) {
            this.data.patch.container.visible = value;
        }
    }

    public get patch(): Patch | null {
        if (this.data.state === 'ready') {
            return this.data.patch;
        }
        return null;
    }

    public get invisibleSince(): number {
        return this.invisibilityTimestamp;
    }

    public async dispose(): Promise<void> {
        if (!this.data.disposed) {
            this.data.disposed = true;
            this.patch?.dispose();
        }
    }

    public hasVisibleMesh(): boolean {
        return this.data.state === "ready" && this.visible && !!this.data.patch;
    }

    public async ready(): Promise<void> {
        if (this.data.state === 'pending') {
            await this.data.promise;
        }
    }
}

export { AsyncPatch };
