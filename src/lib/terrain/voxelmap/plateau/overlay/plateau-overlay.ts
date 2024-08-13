import { vec2ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';

type Parameters = {
    readonly name: string;
    readonly size: THREE.Vector2Like;
    readonly uniforms: Record<string, THREE.IUniform<unknown>>;
    readonly fragmentShader: string;
};

abstract class PlateauOverlay {
    public readonly container: THREE.Object3D;

    private readonly gridSize: THREE.Vector2Like;

    private readonly texture: THREE.DataTexture;
    private readonly textureData: Uint8Array;

    private readonly mesh: THREE.Mesh;
    private readonly material: THREE.Material;

    protected constructor(params: Parameters) {
        this.gridSize = params.size;

        this.textureData = new Uint8Array(4 * this.gridSize.x * this.gridSize.y);
        this.texture = new THREE.DataTexture(this.textureData, this.gridSize.x, this.gridSize.y);

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
                this.gridSize.y,
                this.gridSize.x,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                this.gridSize.y,
                this.gridSize.x,
                0,
                this.gridSize.y,
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

    protected setTexel(position: THREE.Vector2Like, texelData: [number, number, number, number]): void {
        if (position.x < 0 || position.y < 0 || position.x >= this.gridSize.x || position.y >= this.gridSize.y) {
            throw new Error(`Out of bounds position "${vec2ToString(position)}" (size is "${vec2ToString(this.gridSize)}")`);
        }

        const index = 4 * (position.x + position.y * this.gridSize.x);
        this.textureData.set(texelData, index);
        this.texture.needsUpdate = true;
    }
}

export { PlateauOverlay };
