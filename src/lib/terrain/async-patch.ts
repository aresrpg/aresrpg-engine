import { Patch } from './patch/patch';

class AsyncPatch {
    private data:
        | {
              readonly state: 'pending';
              readonly promise: Promise<Patch | null>;
              visible: boolean;
              deleted: boolean;
          }
        | {
              readonly state: 'ready';
              readonly patch: Patch | null;
              deleted: boolean;
          };

    public constructor(container: THREE.Object3D, promise: Promise<Patch | null>) {
        this.data = {
            state: 'pending',
            promise,
            visible: false,
            deleted: false,
        };

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
                deleted: this.data.deleted,
            };
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

    public async dispose(): Promise<void> {
        if (!this.data.deleted) {
            this.data.deleted = true;
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
