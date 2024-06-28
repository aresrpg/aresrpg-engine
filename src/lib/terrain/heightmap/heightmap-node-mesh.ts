import * as THREE from '../../three-usage';

class HeightmapNodeMesh {
    private mesh: THREE.Mesh | null = null;

    private parent: THREE.Object3D | null = null;
    private isDisposed: boolean = false;

    public constructor(meshPromise: Promise<THREE.Mesh>) {
        meshPromise.then(mesh => {
            this.mesh = mesh;

            if (this.parent) {
                this.parent.add(this.mesh);
            }

            if (this.isDisposed) {
                this.dispose();
            }
        });
    }

    public attachTo(parent: THREE.Object3D): void {
        this.parent = parent;

        if (this.mesh) {
            parent.add(this.mesh);
        }
    }

    public dispose(): void {
        this.isDisposed = true;

        if (this.mesh) {
            this.mesh.geometry.dispose();
            if (this.mesh.parent) {
                this.mesh.parent.remove(this.mesh);
            }
            this.mesh = null;
        }
        this.parent = null;
    }

    public get trianglesCountInScene(): number {
        if (!this.mesh || !this.mesh.parent) {
            return 0;
        }
        return this.mesh.geometry.getIndex()!.count / 3;
    }
}

export { HeightmapNodeMesh };
