import * as THREE from '../../../../libs/three-usage';

type GridCoord = { readonly x: number; readonly z: number };

type Parameters = {
    readonly name: string;
    readonly size: GridCoord;
    readonly uniforms: Record<string, THREE.IUniform<unknown>>;
    readonly fragmentShader: string;
};

abstract class BoardOverlay {
    public readonly container: THREE.Object3D;

    protected readonly gridSize: GridCoord;

    private readonly mesh: THREE.Mesh;
    private readonly material: THREE.Material;

    protected constructor(params: Parameters) {
        this.gridSize = params.size;

        this.material = new THREE.ShaderMaterial({
            glslVersion: '300 es',
            transparent: true,
            uniforms: params.uniforms,
            vertexShader: `out vec2 vGridCell;
void main(void) {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vGridCell = position.xz;
}`,
            fragmentShader: params.fragmentShader,
        });

        const v00 = [0, 0, 0];
        const v10 = [this.gridSize.x, 0, 0];
        const v01 = [0, 0, this.gridSize.z];
        const v11 = [this.gridSize.x, 0, this.gridSize.z];
        const positionsAttribute = new THREE.Float32BufferAttribute([...v00, ...v11, ...v10, ...v00, ...v01, ...v11], 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', positionsAttribute);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.frustumCulled = false;
        this.container = new THREE.Group();
        this.container.name = `board-overlay ${params.name}`;
        this.container.add(this.mesh);
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}

export { BoardOverlay, type GridCoord };
