import * as THREE from 'three-usage';

import { type Spritesheet } from '../spritesheet';
import { vec3ToString } from '../../helpers/string';

type Parameters = {
    readonly origin: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly baseSize: THREE.Vector2Like;
};

class InstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly billboardGeometry: THREE.BufferGeometry;
    private readonly billboardMaterial: THREE.Material;
    private readonly meshes: THREE.InstancedMesh[] = [];
    private readonly maxInstancesPerMesh = 2000;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();

        const spritesheet: Spritesheet = {
            texture: new THREE.TextureLoader().load('/resources/tree.png'),
            size: { x: 1, y: 1 },
        };

        const lifetimeUniform: THREE.IUniform<number> = { value: 0 };
        setInterval(() => {
            lifetimeUniform.value = performance.now() / 100;
        }, 50);

        this.billboardGeometry = new THREE.BufferGeometry();
        this.billboardGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute([0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0], 3)
        );
        this.billboardGeometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
        );
        this.billboardGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));

        this.billboardMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uSpritesheetTexture: { value: spritesheet.texture },
                uSpritesheetSize: { value: spritesheet.size },
                uLifetime: lifetimeUniform,
            },
            vertexShader: `
uniform float uLifetime;
uniform vec2 uSpritesheetSize;

varying vec2 vUv;
varying vec2 vSpriteId;

void main() {
    vec3 cameraUp = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
    vec3 lookVector = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));

    vec3 up = ${params.lockAxis ? `vec3(${vec3ToString(new THREE.Vector3().copy(params.lockAxis).normalize(), ', ')})` : 'cameraUp'};
    vec3 right = normalize(cross(up, lookVector));

    const vec2 size = vec2(${params.baseSize.x}, ${params.baseSize.y});
    const vec3 origin = vec3(${params.origin.x.toFixed(3)}, ${params.origin.y.toFixed(3)}, 0);

    vec3 modelPosition = origin +
        size.x * position.x * right +
        size.y * position.y * up;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(modelPosition, 1);
    vUv = uv;

    float spriteId = 3.0;//mod(uLifetime, uSpritesheetSize.x * uSpritesheetSize.y);
    vSpriteId = vec2(0,0);//floor(vec2(
    //     mod(spriteId, uSpritesheetSize.x),
    //     spriteId / uSpritesheetSize.x
    // ));
}
        `,
            fragmentShader: `
uniform sampler2D uSpritesheetTexture;
uniform vec2 uSpritesheetSize;

varying vec2 vUv;
varying vec2 vSpriteId;

vec4 sampleTexture() {
    vec2 uv = (vSpriteId + vUv) / uSpritesheetSize;
    return texture(uSpritesheetTexture, vec2(uv.x, 1.0 - uv.y));
}

void main() {
    vec4 sampled = sampleTexture();
    if (sampled.a < 0.5) {
        discard;
    }
    sampled.rgb /= sampled.a;

    gl_FragColor = vec4(sampled.rgb, 1);
}
`,
            side: THREE.DoubleSide,
        });
    }

    public setInstancesCount(value: number): void {
        const requiredMeshesCount = Math.ceil(value / this.maxInstancesPerMesh);
        while (this.meshes.length < requiredMeshesCount) {
            const mesh = new THREE.InstancedMesh(this.billboardGeometry, this.billboardMaterial, this.maxInstancesPerMesh);
            mesh.count = 0;
            mesh.frustumCulled = false;
            this.container.add(mesh);
            this.meshes.push(mesh);
        }

        this.meshes.forEach((mesh: THREE.InstancedMesh, index: number) => {
            if (value < index * this.maxInstancesPerMesh) {
                mesh.count = 0;
            } else if ((index + 1) * this.maxInstancesPerMesh <= value) {
                mesh.count = this.maxInstancesPerMesh;
            } else {
                mesh.count = value - index * this.maxInstancesPerMesh;
            }
        });
    }

    public setInstanceTransform(instanceId: number, position: THREE.Vector3Like, rotation: number, scaling: number): void {
        const matrix = new THREE.Matrix4().multiplyMatrices(
            new THREE.Matrix4().makeTranslation(position.x, position.y, position.z),
            new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeRotationZ(rotation),
                new THREE.Matrix4().makeScale(scaling, scaling, scaling)
            )
        );

        const mesh = this.meshes[Math.floor(instanceId / this.maxInstancesPerMesh)];
        if (!mesh) {
            throw new Error('No mesh');
        }
        mesh.setMatrixAt(instanceId % this.maxInstancesPerMesh, matrix);
        mesh.instanceMatrix.needsUpdate = true;
    }
}

export { InstancedBillboard };
