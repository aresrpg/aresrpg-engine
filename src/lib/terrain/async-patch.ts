import { Patch } from './patch/patch';

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
              disposed: boolean;
          };

    public readonly id: string;
    public readonly boundingBox: THREE.Box3;
    private invisibilityTimestamp = performance.now();

    public constructor(container: THREE.Object3D, promise: Promise<Patch | null>, id: string, boundingBox: THREE.Box3) {
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

            if (patch) {
                patch.container.visible = this.data.visible;
                container.add(patch.container);
            }

            this.data = {
                state: 'ready',
                patch,
                disposed: this.data.disposed,
            };
            if (this.data.disposed) {
                // disposal has been asked before the computation ended
                this.patch?.dispose();
            }
        });
    }

    public get visible(): boolean {
        if (this.data.state === 'pending') {
            return this.data.visible;
        } else if (this.data.patch) {
            return this.data.patch.container.visible;
        }
        return false;
    }

    public set visible(value: boolean) {
        if (this.visible === value) {
            return; // nothing to do
        }

        if (!value) {
            this.invisibilityTimestamp = performance.now();
        }

        if (this.data.state === 'pending') {
            this.data.visible = value;
        } else if (this.data.patch) {
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

    public async ready(): Promise<void> {
        if (this.data.state === 'pending') {
            await this.data.promise;
        }
    }
}

export { AsyncPatch };
