import * as THREE from 'three-usage';

import { vec3ToString } from '../../helpers/string';

type Parameters = {
    readonly origin?: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly rendering: {
        readonly shadows: {
            readonly receive: boolean;
        };
        readonly uniforms: Record<string, THREE.IUniform<unknown> & { readonly type: string }>;
        readonly attributes: Record<string, { readonly type: "float"; }>;
        readonly fragmentCode: string;
    };
};

type Batch = {
    readonly mesh: THREE.InstancedMesh;
    readonly instanceWorldPositionAttribute: THREE.InstancedBufferAttribute;
    readonly instanceLocalTransformAttribute: THREE.InstancedBufferAttribute;
    readonly instanceCustomAttributes: Record<string, THREE.InstancedBufferAttribute>;
};

const attributeSizes = {
    float: 1,
    vec2: 2,
    vec3: 3,
    vec4: 4,
};

class InstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly billboardMaterial: THREE.Material;

    private readonly batches: Batch[] = [];

    private readonly maxInstancesPerBatch = 2000;

    private readonly customAttributes: Record<string, { readonly type: keyof typeof attributeSizes; }>;

    private readonly shadows: {
        readonly receive: boolean;
    };

    public constructor(params: Parameters) {
        this.container = new THREE.Group();

        this.customAttributes = params.rendering.attributes;

        this.shadows = {
            receive: params.rendering.shadows.receive,
        };

        const spriteOrigin = params.origin ?? { x: 0, y: 0 };

        function applyReplacements(source: string, replacements: Record<string, string>): string {
            let result = source;

            for (const [source, replacement] of Object.entries(replacements)) {
                result = result.replace(source, replacement);
            }

            return result;
        }

        const billboardMaterial = new THREE.MeshPhongMaterial();
        // this.billboardMaterial.side = THREE.DoubleSide;
        // billboardMaterial.shininess = 0;
        billboardMaterial.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...params.rendering.uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
attribute vec3 aInstanceWorldPosition;
attribute mat2 aInstanceLocalTransform;

${Object.entries(params.rendering.attributes).map(([key, attribute]) => `attribute ${attribute.type} a_${key};`).join("\n")}

varying vec2 vUv;
${Object.entries(params.rendering.attributes).map(([key, attribute]) => `varying ${attribute.type} v_${key};`).join("\n")}

void main() {
    vec3 up = ${params.lockAxis
                        ? `vec3(${vec3ToString(new THREE.Vector3().copy(params.lockAxis).normalize(), ', ')})`
                        : 'normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]))'
                    };
    vec3 lookVector = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
    vec3 right = normalize(cross(lookVector, up));
`,
                '#include <begin_vertex>': `
    const vec2 origin2d = vec2(${spriteOrigin.x.toFixed(3)}, ${spriteOrigin.y.toFixed(3)});
    vec2 localPosition2d = aInstanceLocalTransform * (position.xy - origin2d);

    vec3 transformed = aInstanceWorldPosition + localPosition2d.x * right + localPosition2d.y * up;

    vUv = uv;
    ${Object.keys(params.rendering.attributes).map(key => `v_${key} = a_${key};`).join("\n")}
`,
                '#include <beginnormal_vertex>': `
    vec3 objectNormal = lookVector;
`,
            });

            parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
                'void main() {': `
${Object.entries(params.rendering.uniforms)
                        .map(([key, uniform]) => `uniform ${uniform.type} ${key};`)
                        .join('\n')}

varying vec2 vUv;

${Object.entries(params.rendering.attributes).map(([key, attribute]) => `varying ${attribute.type} v_${key};`).join("\n")}

vec4 getColor(
    const vec2 uv
    ${Object.entries(params.rendering.attributes).map(([key, attribute]) => `, const ${attribute.type} ${key}`).join("")}
    ) {
    ${params.rendering.fragmentCode}
}

void main() {`,
                '#include <map_fragment>': `
    diffuseColor.rgb = getColor(
        vUv
        ${Object.keys(params.rendering.attributes).map(key => `, v_${key}`).join("")}
    ).rgb;
`,
            });
        };
        this.billboardMaterial = billboardMaterial;
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

    public setInstanceCustomAttribute(instanceId: number, name: string, value: ReadonlyArray<number>): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);

        const customAttribute = batch.instanceCustomAttributes[name];
        const definition = this.customAttributes[name];
        if (!customAttribute || !definition) {
            throw new Error(`Unknown attribute "${name}".`);
        }

        const size = attributeSizes[definition.type];
        if (typeof definition.type === "undefined") {
            throw new Error(`Unknown attribute type "${definition.type}".`);
        }

        if (value.length !== size) {
            throw new Error(`Invalid value size for "${name}": "${value.length}", expected "${size}".`);
        }

        (customAttribute.array as Float32Array).set(value, size * localInstanceId);
        customAttribute.needsUpdate = true;
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

        const instanceCustomAttributes: Record<string, THREE.InstancedBufferAttribute> = {};
        for (const [name, definition] of Object.entries(this.customAttributes)) {
            const size = attributeSizes[definition.type];
            if (typeof size === "undefined") {
                throw new Error();
            }

            const customAttribute = new THREE.InstancedBufferAttribute(new Float32Array(size * this.maxInstancesPerBatch), size);
            billboardGeometry.setAttribute(`a_${name}`, customAttribute)
            instanceCustomAttributes[name] = customAttribute;
        }

        const mesh = new THREE.InstancedMesh(billboardGeometry, this.billboardMaterial, this.maxInstancesPerBatch);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.receiveShadow = this.shadows.receive;
        mesh.castShadow = false;

        return {
            mesh,
            instanceWorldPositionAttribute,
            instanceLocalTransformAttribute,
            instanceCustomAttributes,
        };
    }
}

export { InstancedBillboard };
