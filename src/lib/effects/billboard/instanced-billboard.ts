import * as THREE from 'three-usage';

import { type Spritesheet } from '../spritesheet';
import { vec3ToString } from '../../helpers/string';

type Parameters = {
    readonly origin: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly baseSize: THREE.Vector2Like;
    readonly maxInstancesCount: number;
};

class InstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly mesh: THREE.InstancedMesh;
    public readonly maxInstancesCount: number;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.maxInstancesCount = params.maxInstancesCount;

        const spritesheet: Spritesheet = {
            texture: new THREE.TextureLoader().load('/resources/puff.png'),
            size: { x: 3, y: 4 },
        };

        const lifetimeUniform: THREE.IUniform<number> = { value: 0 };
        setInterval(() => {
            lifetimeUniform.value = performance.now() / 100;
        }, 50);

        const bufferGeometry = new THREE.BufferGeometry();
        bufferGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute([0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0], 3)
        );
        bufferGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
        bufferGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));

        this.mesh = new THREE.InstancedMesh(
            bufferGeometry,
            new THREE.ShaderMaterial({
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

    // vec4 instanceOrigin4 = instanceMatrix * vec4(origin, 1);
    // vec3 instanceOrigin = instanceOrigin4.xyz / instanceOrigin4.w;

    vec3 modelPosition = origin +
        size.x * position.x * right +
        size.y * position.y * up;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(modelPosition, 1);
    vUv = uv;

    float spriteId = 3.0;//mod(uLifetime, uSpritesheetSize.x * uSpritesheetSize.y);
    vSpriteId = floor(vec2(
        mod(spriteId, uSpritesheetSize.x),
        spriteId / uSpritesheetSize.x
    ));
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
        // discard;
    }
    // sampled.rgb /= sampled.a;

    gl_FragColor = vec4(vUv, 0, 1) + 0.000001 * vec4(sampled.rgb, 1);
}
`,
                side: THREE.DoubleSide,
            }),
            params.maxInstancesCount
        );
        this.mesh.frustumCulled = false;
        this.container.add(this.mesh);
    }

    public setInstancesCount(value: number): void {
        this.mesh.count = value;
    }

    public setInstanceTransform(instanceId: number, position: THREE.Vector3Like, rotation: number, scaling: number): void {
        const matrix = new THREE.Matrix4().multiplyMatrices(
            new THREE.Matrix4().makeTranslation(position.x, position.y, position.z),
            new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeRotationZ(rotation),
                new THREE.Matrix4().makeScale(scaling, scaling, scaling)
            )
        );
        this.mesh.setMatrixAt(instanceId, matrix);
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

export { InstancedBillboard };
