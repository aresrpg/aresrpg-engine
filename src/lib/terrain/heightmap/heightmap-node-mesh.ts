import * as THREE from '../../three-usage';

class HeightmapNodeMesh {
    public readonly mesh: THREE.Mesh;

    public constructor(mesh: THREE.Mesh) {
        this.mesh = mesh;
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
    }
}

export { HeightmapNodeMesh };
