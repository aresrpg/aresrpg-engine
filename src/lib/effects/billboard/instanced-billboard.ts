import * as THREE from '../../libs/three-usage';

import { createBillboardMaterial } from './billboard-shader';
import { type CustomAttributesDefinition, InstancedBillboardBatch } from './instanced-billboard-batch';

type UniformType = 'sampler2D' | 'float' | 'vec2' | 'vec3' | 'vec4';

type Parameters = {
    readonly origin?: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly maxInstancesCount?: number;
    readonly rendering: {
        readonly material: 'Basic' | 'Phong';
        readonly blending?: THREE.Blending;
        readonly depthWrite?: boolean;
        readonly transparent?: boolean;
        readonly shadows: {
            readonly receive: boolean;
        };
        readonly uniforms: Record<string, THREE.IUniform<unknown> & { readonly type: UniformType }>;
        readonly attributes: CustomAttributesDefinition;
        readonly fragmentCode: string;
    };
};

class InstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly billboardMaterial: THREE.Material;

    private readonly batches: InstancedBillboardBatch[] = [];

    private readonly maxInstancesCount: number;

    private readonly customAttributes: CustomAttributesDefinition;

    private readonly shadows: {
        readonly receive: boolean;
    };

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'instanced-billboard-container';

        this.maxInstancesCount = params.maxInstancesCount ?? Infinity;

        this.customAttributes = params.rendering.attributes;

        this.shadows = {
            receive: params.rendering.shadows.receive,
        };

        this.billboardMaterial = createBillboardMaterial({
            origin: params.origin,
            lockAxis: params.lockAxis,
            material: params.rendering.material,
            blending: params.rendering.blending,
            depthWrite: params.rendering.depthWrite,
            transparent: params.rendering.transparent,
            uniforms: params.rendering.uniforms,
            attributes: {
                ...params.rendering.attributes,
                aInstanceWorldPosition: { type: 'vec3' },
                aInstanceLocalTransform: { type: 'mat2' },
            },
            varyings: params.rendering.attributes,
            vertex: {
                getBillboardAndSetVaryingsCode: `
modelPosition = aInstanceWorldPosition;
localTransform = aInstanceLocalTransform;

${Object.keys(params.rendering.attributes)
    .map(key => `v_${key} = ${key};`)
    .join('\n')}
`,
            },
            fragment: {
                getColorCode: params.rendering.fragmentCode,
            },
        });
    }

    public setInstancesCount(instancesCount: number): void {
        if (instancesCount > this.maxInstancesCount) {
            throw new Error(`Cannot set instancescount="${instancesCount}" because max is "${this.maxInstancesCount}".`);
        }

        let currentInstancesCapacity = 0;
        for (const batch of this.batches) {
            currentInstancesCapacity += batch.maxInstancesCount;
        }
        while (currentInstancesCapacity < instancesCount) {
            const maxBatchSize = 2000;
            const batchSize = Math.min(maxBatchSize, this.maxInstancesCount - currentInstancesCapacity);
            const batch = this.createBatch(batchSize);
            this.container.add(batch.object);
            this.batches.push(batch);
            currentInstancesCapacity += batch.maxInstancesCount;
        }

        let batchInstanceIdStart = 0;
        for (const batch of this.batches) {
            if (instancesCount < batchInstanceIdStart) {
                batch.setInstancesCount(0);
            } else if (instancesCount < batchInstanceIdStart + batch.maxInstancesCount) {
                batch.setInstancesCount(instancesCount - batchInstanceIdStart);
            } else {
                batch.setInstancesCount(batch.maxInstancesCount);
            }
            batchInstanceIdStart += batch.maxInstancesCount;
        }
    }

    public setInstancePosition(instanceId: number, position: THREE.Vector3Like): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);
        batch.setInstancePosition(localInstanceId, position);
    }

    public setInstanceTransform(instanceId: number, rotation: number, size: THREE.Vector2Like): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);
        batch.setInstanceTransform(localInstanceId, rotation, size);
    }

    public setInstanceCustomAttribute(instanceId: number, name: string, value: ReadonlyArray<number>): void {
        const { batch, localInstanceId } = this.getBatchInstanceId(instanceId);
        batch.setInstanceCustomAttribute(localInstanceId, name, value);
    }

    public dispose(): void {
        throw new Error('Not implemented');
    }

    private getBatchInstanceId(instanceId: number): { readonly batch: InstancedBillboardBatch; readonly localInstanceId: number } {
        let batchInstanceIdStart = 0;
        for (const batch of this.batches) {
            if (batchInstanceIdStart <= instanceId && instanceId < batchInstanceIdStart + batch.maxInstancesCount) {
                const localInstanceId = instanceId - batchInstanceIdStart;
                return { batch, localInstanceId };
            }
            batchInstanceIdStart += batch.maxInstancesCount;
        }

        throw new Error(`InstanceId ${instanceId} is incorrect. Have you called setInstancesCount() ?`);
    }

    private createBatch(maxInstancesCount: number): InstancedBillboardBatch {
        return new InstancedBillboardBatch({
            billboardMaterial: this.billboardMaterial,
            maxInstancesCount,
            customAttributes: this.customAttributes,
            receiveShadows: this.shadows.receive,
        });
    }
}

export { InstancedBillboard };
