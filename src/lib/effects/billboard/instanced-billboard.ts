import * as THREE from 'three-usage';

import { vec3ToString } from '../../helpers/string';

type Parameters = {
    readonly origin?: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly rendering: {
        readonly uniforms: Record<string, THREE.IUniform<unknown> & { readonly type: string }>;
        readonly fragmentCode: string;
    };
};

type Batch = {
    readonly mesh: THREE.InstancedMesh;
    readonly instanceWorldPositionAttribute: THREE.InstancedBufferAttribute;
    readonly instanceLocalTransformAttribute: THREE.InstancedBufferAttribute;
};

class InstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly billboardMaterial: THREE.Material;

    private readonly batches: Batch[] = [];

    private readonly maxInstancesPerBatch = 2000;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();

        const spriteOrigin = params.origin ?? { x: 0, y: 0 };

        this.billboardMaterial = new THREE.ShaderMaterial({
            uniforms: params.rendering.uniforms,
            vertexShader: `
attribute vec3 aInstanceWorldPosition;
attribute mat2 aInstanceLocalTransform;

varying vec2 vUv;

void main() {
    vec3 up = ${
        params.lockAxis
            ? `vec3(${vec3ToString(new THREE.Vector3().copy(params.lockAxis).normalize(), ', ')})`
            : 'normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]))'
    };
    vec3 lookVector = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
    vec3 right = normalize(cross(lookVector, up));

    const vec2 origin2d = vec2(${spriteOrigin.x.toFixed(3)}, ${spriteOrigin.y.toFixed(3)});
    vec2 localPosition2d = aInstanceLocalTransform * (position.xy - origin2d);

    vec3 worldPosition = aInstanceWorldPosition + localPosition2d.x * right + localPosition2d.y * up;

    gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1);
    vUv = uv;
}
        `,
            fragmentShader: `
${Object.entries(params.rendering.uniforms)
    .map(([key, uniform]) => `uniform ${uniform.type} ${key};`)
    .join('\n')}

varying vec2 vUv;

vec4 getColor(const vec2 uv) {
    ${params.rendering.fragmentCode}
}

void main() {
    vec4 color = getColor(vUv);
    gl_FragColor = color;
}
`,
            side: THREE.DoubleSide,
        });
    }

    public setInstancesCount(value: number): void {
        const requiredMeshesCount = Math.ceil(value / this.maxInstancesPerBatch);
        while (this.batches.length < requiredMeshesCount) {
            const batch = this.createBatch();
            this.container.add(batch.mesh);
            this.batches.push(batch);
        }

        this.batches.forEach((batch: Batch, index: number) => {
            const mesh = batch.mesh;

            if (value < index * this.maxInstancesPerBatch) {
                mesh.count = 0;
            } else if ((index + 1) * this.maxInstancesPerBatch <= value) {
                mesh.count = this.maxInstancesPerBatch;
            } else {
                mesh.count = value - index * this.maxInstancesPerBatch;
            }
        });
    }

    public setInstancePosition(instanceId: number, position: THREE.Vector3Like): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);

        (batch.instanceWorldPositionAttribute.array as Float32Array).set([position.x, position.y, position.z], 3 * localInstanceId);
        batch.instanceWorldPositionAttribute.needsUpdate = true;
    }

    public setInstanceTransform(instanceId: number, rotation: number, size: THREE.Vector2Like): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);

        const cosTheta = Math.cos(rotation);
        const sinTheta = Math.sin(rotation);
        (batch.instanceLocalTransformAttribute.array as Float32Array).set(
            [size.x * cosTheta, sinTheta * size.x, -sinTheta * size.y, size.y * cosTheta],
            4 * localInstanceId
        );
        batch.instanceLocalTransformAttribute.needsUpdate = true;
    }

    private getBatchInstanceId(instanceId: number): { readonly batch: Batch; readonly localInstanceId: number } {
        const batchId = Math.floor(instanceId / this.maxInstancesPerBatch);
        const batch = this.batches[batchId];
        if (!batch) {
            throw new Error('No mesh');
        }
        const localInstanceId = instanceId % this.maxInstancesPerBatch;
        return { batch, localInstanceId };
    }

    private createBatch(): Batch {
        const billboardGeometry = new THREE.InstancedBufferGeometry();
        billboardGeometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute([0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0], 3)
        );
        billboardGeometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
        );
        billboardGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0], 2));

        const instancedWorldPositionBuffer: number[] = [];
        const instanceLocalTransformBuffer: number[] = [];
        for (let i = 0; i < this.maxInstancesPerBatch; i++) {
            instancedWorldPositionBuffer.push(0, 0, 0);
            instanceLocalTransformBuffer.push(1 / 15, 0, 0, 1 / 15);
        }

        const instanceWorldPositionAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instancedWorldPositionBuffer), 3);
        billboardGeometry.setAttribute('aInstanceWorldPosition', instanceWorldPositionAttribute);

        const instanceLocalTransformAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instanceLocalTransformBuffer), 4);
        billboardGeometry.setAttribute('aInstanceLocalTransform', instanceLocalTransformAttribute);

        const mesh = new THREE.InstancedMesh(billboardGeometry, this.billboardMaterial, this.maxInstancesPerBatch);
        mesh.count = 0;
        mesh.frustumCulled = false;

        return {
            mesh,
            instanceWorldPositionAttribute,
            instanceLocalTransformAttribute,
        };
    }
}

export { InstancedBillboard };
