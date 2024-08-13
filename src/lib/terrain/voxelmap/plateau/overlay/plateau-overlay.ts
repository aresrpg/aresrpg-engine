import * as THREE from '../../../../three-usage';

type GridCoord = { readonly x: number, readonly z: number };

type Parameters = {
    readonly name: string;
    readonly size: GridCoord;
    readonly uniforms: Record<string, THREE.IUniform<unknown>>;
    readonly fragmentShader: string;
};

abstract class PlateauOverlay {
    public readonly container: THREE.Object3D;

    private readonly gridSize: GridCoord;

    private readonly texture: THREE.DataTexture;
    private readonly textureData: Uint8Array;

    private readonly mesh: THREE.Mesh;
    private readonly material: THREE.Material;

    protected constructor(params: Parameters) {
        this.gridSize = params.size;

        this.textureData = new Uint8Array(4 * this.gridSize.x * this.gridSize.z);
        this.texture = new THREE.DataTexture(this.textureData, this.gridSize.x, this.gridSize.z);

        this.material = new THREE.ShaderMaterial({
            glslVersion: '300 es',
            transparent: true,
            uniforms: { ...params.uniforms, uDataTexture: { value: this.texture } },
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
        this.container.name = `plateau-overlay ${params.name}`;
        this.container.add(this.mesh);
    }

    public clear(): void {
        this.textureData.fill(0);
        this.texture.needsUpdate = true;
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        this.material.dispose();
    }

    protected setTexel(position: GridCoord, texelData: [number, number, number, number]): void {
        if (position.x < 0 || position.z < 0 || position.x >= this.gridSize.x || position.z >= this.gridSize.z) {
            throw new Error(`Out of bounds position "${position.x}x${position.z}" (size is "${this.gridSize.x}x${this.gridSize.z}")`);
        }

        const index = 4 * (position.x + position.z * this.gridSize.x);
        this.textureData.set(texelData, index);
        this.texture.needsUpdate = true;
    }
}

export { PlateauOverlay, type GridCoord };

