import * as THREE from '../../../../three-usage';

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

        const positionsAttribute = new THREE.Float32BufferAttribute(
            [
                0,
                0,
                0,
                this.gridSize.x,
                0,
                this.gridSize.z,
                this.gridSize.x,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                this.gridSize.z,
                this.gridSize.x,
                0,
                this.gridSize.z,
            ],
            3
        );
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
