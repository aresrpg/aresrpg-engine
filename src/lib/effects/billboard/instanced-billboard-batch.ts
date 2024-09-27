import * as THREE from '../../libs/three-usage';

import { createBillboardInstancedBufferGeometry } from './billboard-shader';

const attributeSizes = {
    float: 1,
    vec2: 2,
    vec3: 3,
    vec4: 4,
};

type CustomAttributesDefinition = Record<string, { readonly type: keyof typeof attributeSizes }>;

type CustomAttribute = {
    readonly size: number;
    readonly bufferAttribute: THREE.InstancedBufferAttribute;
};

type Parameters = {
    readonly billboardMaterial: THREE.Material;
    readonly maxInstancesCount: number;
    readonly customAttributes: CustomAttributesDefinition;
    readonly receiveShadows: boolean;
};

class InstancedBillboardBatch {
    public get object(): THREE.Object3D {
        return this.mesh;
    }

    private readonly mesh: THREE.InstancedMesh;
    public readonly maxInstancesCount: number;
    private readonly instanceWorldPositionAttribute: THREE.InstancedBufferAttribute;
    private readonly instanceLocalTransformAttribute: THREE.InstancedBufferAttribute;
    private readonly instanceCustomAttributes: Record<string, CustomAttribute>;

    public constructor(params: Parameters) {
        const billboardGeometry = createBillboardInstancedBufferGeometry();

        const instancedWorldPositionBuffer: number[] = [];
        const instanceLocalTransformBuffer: number[] = [];
        for (let i = 0; i < params.maxInstancesCount; i++) {
            instancedWorldPositionBuffer.push(0, 0, 0);
            instanceLocalTransformBuffer.push(1 / 15, 0, 0, 1 / 15);
        }

        this.instanceWorldPositionAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instancedWorldPositionBuffer), 3);
        billboardGeometry.setAttribute('aInstanceWorldPosition', this.instanceWorldPositionAttribute);

        this.instanceLocalTransformAttribute = new THREE.InstancedBufferAttribute(new Float32Array(instanceLocalTransformBuffer), 4);
        billboardGeometry.setAttribute('aInstanceLocalTransform', this.instanceLocalTransformAttribute);

        this.instanceCustomAttributes = {};
        for (const [name, definition] of Object.entries(params.customAttributes)) {
            const size = attributeSizes[definition.type];
            if (typeof size === 'undefined') {
                throw new Error();
            }

            const bufferAttribute = new THREE.InstancedBufferAttribute(new Float32Array(size * params.maxInstancesCount), size);
            billboardGeometry.setAttribute(`a_${name}`, bufferAttribute);
            this.instanceCustomAttributes[name] = { bufferAttribute, size };
        }

        this.mesh = new THREE.InstancedMesh(billboardGeometry, params.billboardMaterial, params.maxInstancesCount);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = params.receiveShadows;
        this.mesh.castShadow = false;

        this.maxInstancesCount = params.maxInstancesCount;
    }

    public setInstancesCount(instancesCount: number): void {
        if (instancesCount < 0 || instancesCount > this.maxInstancesCount || !Number.isInteger(instancesCount)) {
            throw new Error(`Invalid instances count "${instancesCount}".`);
        }
        this.mesh.count = instancesCount;
    }

    public setInstancePosition(instanceId: number, position: THREE.Vector3Like): void {
        (this.instanceWorldPositionAttribute.array as Float32Array).set([position.x, position.y, position.z], 3 * instanceId);
        this.instanceWorldPositionAttribute.needsUpdate = true;
    }

    public setInstanceTransform(instanceId: number, rotation: number, size: THREE.Vector2Like): void {
        const cosTheta = Math.cos(rotation);
        const sinTheta = Math.sin(rotation);
        (this.instanceLocalTransformAttribute.array as Float32Array).set(
            [size.x * cosTheta, sinTheta * size.x, -sinTheta * size.y, size.y * cosTheta],
            4 * instanceId
        );
        this.instanceLocalTransformAttribute.needsUpdate = true;
    }

    public setInstanceCustomAttribute(instanceId: number, name: string, value: ReadonlyArray<number>): void {
        const customAttribute = this.instanceCustomAttributes[name];
        if (!customAttribute) {
            throw new Error(`Unknown attribute "${name}".`);
        }
        const { bufferAttribute, size } = customAttribute;
        if (value.length !== size) {
            throw new Error(`Invalid value size for "${name}": "${value.length}", expected "${size}".`);
        }

        (bufferAttribute.array as Float32Array).set(value, size * instanceId);
        bufferAttribute.needsUpdate = true;
    }

    public dispose(): void {
        throw new Error('Not implemented');
    }
}

export { InstancedBillboardBatch, type CustomAttributesDefinition };
