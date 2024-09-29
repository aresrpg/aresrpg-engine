import { nextPowerOfTwo } from '../../../helpers/math';
import * as THREE from '../../../libs/three-usage';
import { createBillboardInstancedBufferGeometry, createBillboardMaterial, type UniformDefinition } from '../billboard-shader';

import { GpuTexturesState } from './gpu-textures-state';

type UniformType = 'sampler2D' | 'float' | 'vec2' | 'vec3' | 'vec4';

type Parameters = {
    readonly origin?: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly maxInstancesCount: number;
    readonly rendering: {
        readonly material: 'Basic' | 'Phong';
        readonly blending?: THREE.Blending;
        readonly depthWrite?: boolean;
        readonly transparent?: boolean;
        readonly shadows: {
            readonly receive: boolean;
        };
        readonly uniforms: Record<string, THREE.IUniform<unknown> & { readonly type: UniformType }>;
        readonly fragmentCode: string;
    };
};

class GpuInstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly gpuTexturesState: GpuTexturesState;

    public readonly positionsRange = new THREE.Vector3(1, 1, 1);

    private readonly mesh: THREE.InstancedMesh;

    private readonly updatePipeline: {
        readonly uniforms: {
            readonly uUniformMovement: THREE.IUniform<THREE.Vector3Like> & { type: 'vec3' };
            readonly uDeltaTime: THREE.IUniform<number> & { type: 'float' };
        };
    };

    private readonly displayPipeline: {
        readonly shader: THREE.Material;
        readonly uniforms: {
            readonly uPositionXYTexture: THREE.IUniform<THREE.Texture | null>;
            readonly uPositionZWTexture: THREE.IUniform<THREE.Texture | null>;
            readonly uPositionsRange: THREE.IUniform<THREE.Vector3Like>;
        };
    };

    private readonly noiseTextures: [THREE.DataTexture, THREE.DataTexture];

    private readonly maxInstancesCount: number;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();

        const textureSize = nextPowerOfTwo(Math.floor(Math.sqrt(params.maxInstancesCount)));
        if (params.maxInstancesCount > textureSize * textureSize) {
            throw new Error('Too many particles');
        }

        const createNoiseTexture = () => {
            const textureData = new Uint8Array(4 * textureSize * textureSize);
            for (let i = 0; i < textureData.length; i++) {
                textureData[i] = Math.floor(256 * Math.random());
            }
            const texture = new THREE.DataTexture(textureData, textureSize, textureSize, THREE.RGBAFormat);
            texture.needsUpdate = true;
            return texture;
        };

        this.noiseTextures = [createNoiseTexture(), createNoiseTexture()];

        this.updatePipeline = {
            uniforms: {
                uUniformMovement: { value: { x: 0, y: 0, z: 0 }, type: 'vec3' },
                uDeltaTime: { value: 0, type: 'float' },
            },
        };

        this.gpuTexturesState = new GpuTexturesState({
            width: textureSize,
            height: textureSize,
            textureNames: ['positionsTexture1', 'positionsTexture2'],
            pipelines: {
                initialize: {
                    uniforms: {
                        uNoiseTexture1: { value: this.noiseTextures[0], type: 'sampler2D' },
                        uNoiseTexture2: { value: this.noiseTextures[1], type: 'sampler2D' },
                    },
                    requiresPreviousState: false,
                    shaderCode: `
out_positionsTexture1 = texture(uNoiseTexture1, vUv);
out_positionsTexture2 = texture(uNoiseTexture2, vUv);
                `,
                },
                update: {
                    uniforms: this.updatePipeline.uniforms,
                    requiresPreviousState: true,
                    shaderCode: `
vec3 previousPosition = vec3(
    unpackRGBATo2Half(in_positionsTexture1),
    unpackRGBATo2Half(in_positionsTexture2).x
);

vec3 newPosition = previousPosition + vec3(0, -1, 0) * uDeltaTime + uUniformMovement;
newPosition = mod(newPosition, vec3(1,1,1));

out_positionsTexture1 = pack2HalfToRGBA(newPosition.xy);
out_positionsTexture2 = pack2HalfToRGBA(vec2(newPosition.z, 0));
                    `,
                },
            },
        });

        this.maxInstancesCount = params.maxInstancesCount;

        {
            const displayPipelineUniforms = {
                uPositionXYTexture: { value: null, type: 'sampler2D' } as UniformDefinition<THREE.Texture | null>,
                uPositionZWTexture: { value: null, type: 'sampler2D' } as UniformDefinition<THREE.Texture | null>,
                uPositionsRange: { value: this.positionsRange, type: 'vec3' } as UniformDefinition<THREE.Vector3Like>,
            };

            this.displayPipeline = {
                shader: createBillboardMaterial({
                    origin: params.origin,
                    lockAxis: params.lockAxis,
                    material: params.rendering.material,
                    blending: params.rendering.blending,
                    depthWrite: params.rendering.depthWrite,
                    transparent: params.rendering.transparent,
                    uniforms: displayPipelineUniforms,
                    attributes: {},
                    varyings: {},
                    vertex: {
                        getBillboardAndSetVaryingsCode: `
ivec2 texelId = ivec2(
    int(mod(float(gl_InstanceID), ${textureSize.toFixed(1)})),
    gl_InstanceID / ${textureSize.toFixed()}
);

vec4 positionXYTexel = texelFetch(uPositionXYTexture, texelId, 0);
vec4 positionZWTexel = texelFetch(uPositionZWTexture, texelId, 0);

vec3 positionInBox = vec3(
    unpackRGBATo2Half(positionXYTexel),
    unpackRGBATo2Half(positionZWTexel).x
);
modelPosition = uPositionsRange * positionInBox;
vec3 positionFromBoxCenter = positionInBox - 0.5;
float distanceSqFromBoxCenter = dot(positionFromBoxCenter, positionFromBoxCenter);

float size = 0.2 * (1.0 - smoothstep(0.23, 0.25, distanceSqFromBoxCenter));
localTransform = mat2(size, 0, 0, size);`,
                    },
                    fragment: {
                        getColorCode: params.rendering.fragmentCode,
                    },
                }),
                uniforms: displayPipelineUniforms,
            };
        }

        {
            const billboardGeometry = createBillboardInstancedBufferGeometry();
            this.mesh = new THREE.InstancedMesh(billboardGeometry, this.displayPipeline.shader, params.maxInstancesCount);
            this.mesh.count = 0;
            this.mesh.frustumCulled = false;
            this.mesh.receiveShadow = params.rendering.shadows.receive;
            this.mesh.castShadow = false;
            this.container.add(this.mesh);
        }

        this.enforceCurrentPositionTexture();
    }

    public setInstancesCount(instancesCount: number): void {
        if (instancesCount > this.maxInstancesCount) {
            throw new Error(`Cannot set instancescount="${instancesCount}" because max is "${this.maxInstancesCount}".`);
        }
        this.mesh.count = instancesCount;
    }

    public dispose(): void {
        throw new Error('Not implemented');
    }

    public initializePositions(renderer: THREE.WebGLRenderer): void {
        this.gpuTexturesState.runPipeline(renderer, 'initialize');
        this.enforceCurrentPositionTexture();
    }

    public updatePositions(renderer: THREE.WebGLRenderer, deltaTime: number, uniformMovement: THREE.Vector3Like): void {
        this.updatePipeline.uniforms.uDeltaTime.value = deltaTime;
        this.updatePipeline.uniforms.uUniformMovement.value = uniformMovement;
        this.gpuTexturesState.runPipeline(renderer, 'update');
        this.enforceCurrentPositionTexture();
    }

    private enforceCurrentPositionTexture(): void {
        this.displayPipeline.uniforms.uPositionXYTexture.value = this.gpuTexturesState.getCurrentTexture('positionsTexture1');
        this.displayPipeline.uniforms.uPositionZWTexture.value = this.gpuTexturesState.getCurrentTexture('positionsTexture2');
    }
}

export { GpuInstancedBillboard };
