import { nextPowerOfTwo } from '../../helpers/math';
import * as THREE from '../../libs/three-usage';
import { createBillboardInstancedBufferGeometry, createBillboardMaterial, type UniformDefinition } from '../billboard/billboard-shader';
import { GpuTexturesState } from '../billboard/gpu/gpu-textures-state';

type UniformType = 'sampler2D' | 'float' | 'vec2' | 'vec3' | 'vec4';

type Parameters = {
    readonly origin?: THREE.Vector2Like;
    readonly lockAxis?: THREE.Vector3Like;
    readonly maxInstancesCount: number;
    readonly maxDistance: number;
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
    readonly size: THREE.Vector2Like;
    readonly speed: number;
};

class GpuInstancedBillboard {
    public readonly container: THREE.Object3D;

    private readonly gpuTexturesState: GpuTexturesState;

    public readonly maxDistance: number;

    private readonly mesh: THREE.InstancedMesh;

    private readonly updatePipeline: {
        readonly uniforms: {
            readonly uWorldX: THREE.IUniform<THREE.Vector3Like> & { type: 'vec3' };
            readonly uWorldY: THREE.IUniform<THREE.Vector3Like> & { type: 'vec3' };
            readonly uWorldZ: THREE.IUniform<THREE.Vector3Like> & { type: 'vec3' };
            readonly uUniformMovementView: THREE.IUniform<THREE.Matrix4> & { type: 'mat4' };
            readonly uDeltaTime: THREE.IUniform<number> & { type: 'float' };
        };
    };

    private readonly displayPipeline: {
        readonly shader: THREE.Material;
        readonly uniforms: {
            readonly uPositionXYTexture: THREE.IUniform<THREE.Texture | null>;
            readonly uPositionZWTexture: THREE.IUniform<THREE.Texture | null>;
            readonly uMaxDistance: THREE.IUniform<number>;
        };
    };

    private readonly noiseTextures: [THREE.DataTexture, THREE.DataTexture];

    private readonly maxInstancesCount: number;

    private lastViewMatrix: THREE.Matrix4 | null = null;

    private lastUpdateTimestamp = performance.now();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();

        this.maxDistance = params.maxDistance;

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
                uWorldX: { value: { x: 1, y: 0, z: 0 }, type: 'vec3' },
                uWorldY: { value: { x: 0, y: 1, z: 0 }, type: 'vec3' },
                uWorldZ: { value: { x: 0, y: 0, z: 1 }, type: 'vec3' },
                uUniformMovementView: { value: new THREE.Matrix4(), type: 'mat4' },
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
vec3 previousPositionInBox = vec3(
    unpackRGBATo2Half(in_positionsTexture1),
    unpackRGBATo2Half(in_positionsTexture2).x
);
vec3 previousViewPosition = previousPositionInBox - 0.5;

vec3 gravityWorld = vec3(0, -${params.speed}, 0);
vec3 gravityView = 
    gravityWorld.x * uWorldX +
    gravityWorld.y * uWorldY +
    gravityWorld.z * uWorldZ;

vec3 newViewPosition = previousViewPosition + gravityView * uDeltaTime;
vec4 newViewPosition4 = uUniformMovementView * vec4(newViewPosition, 1);
newViewPosition = newViewPosition4.xyz / newViewPosition4.w;

// float dist = distance(newViewPosition, newViewPositionIdeal);
// if (dist > 0.01) {
//     newViewPosition = mix(newViewPosition, newViewPositionIdeal, 0.01 / dist);
// } else {
//     newViewPosition = newViewPositionIdeal;
// }

vec3 newPositionInBox = newViewPosition + 0.5;
newPositionInBox = mod(newPositionInBox, vec3(1,1,0.5));

out_positionsTexture1 = pack2HalfToRGBA(newPositionInBox.xy);
out_positionsTexture2 = pack2HalfToRGBA(vec2(newPositionInBox.z, 0));
                    `,
                },
            },
        });

        this.maxInstancesCount = params.maxInstancesCount;

        {
            const displayPipelineUniforms = {
                uPositionXYTexture: { value: null, type: 'sampler2D' } as UniformDefinition<THREE.Texture | null>,
                uPositionZWTexture: { value: null, type: 'sampler2D' } as UniformDefinition<THREE.Texture | null>,
                uMaxDistance: { value: this.maxDistance, type: 'float' } as UniformDefinition<number>,
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
vec3 viewPositionNormalized = positionInBox - 0.5;
vec3 viewPosition = uMaxDistance * viewPositionNormalized;
vec4 modelPosition4 = inverse(viewMatrix) * vec4(viewPosition, 1);
modelPosition = modelPosition4.xyz / modelPosition4.w;

float distanceSqFromBoxCenter = dot(viewPositionNormalized, viewPositionNormalized);

vec2 size = vec2(${params.size.x.toFixed(2)}, ${params.size.y.toFixed(2)}) * (1.0 - smoothstep(0.23, 0.25, distanceSqFromBoxCenter));
localTransform = mat2(size.x, 0, 0, size.y);`,
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

    public updatePositions(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
        const now = performance.now();
        const deltaTime = (now - this.lastUpdateTimestamp) / 1000;
        this.lastUpdateTimestamp = now;

        camera.updateMatrixWorld();
        const currentViewMatrix = new THREE.Matrix4().multiplyMatrices(
            new THREE.Matrix4().makeScale(1 / this.maxDistance, 1 / this.maxDistance, 1 / this.maxDistance),
            camera.matrixWorldInverse.clone(),
        );

        const deltaMatrix = new THREE.Matrix4();
        if (this.lastViewMatrix) {
            deltaMatrix.multiplyMatrices(currentViewMatrix, this.lastViewMatrix.invert());
        }
        this.lastViewMatrix = currentViewMatrix;

        // todo limit movement length to avoid floating-point precision issues
        const translation = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        deltaMatrix.decompose(translation, rotation, scale);
        if (translation.length() > 10) {
            translation.multiplyScalar(10 / translation.length());
        }
        deltaMatrix.compose(translation, rotation, scale);

        const vectorWorldToView = (v: THREE.Vector3Like): THREE.Vector3Like => {
            const v4 = new THREE.Vector4(v.x, v.y, v.z, 0).applyMatrix4(camera.matrixWorldInverse);
            if (v4.w === 0) {
                v4.w = 1;
            }
            const result = new THREE.Vector3(v4.x, v4.y, v4.z);
            return result.normalize();
        };

        this.updatePipeline.uniforms.uWorldX.value = vectorWorldToView({ x: 1, y: 0, z: 0 });
        this.updatePipeline.uniforms.uWorldY.value = vectorWorldToView({ x: 0, y: 1, z: 0 });
        this.updatePipeline.uniforms.uWorldZ.value = vectorWorldToView({ x: 0, y: 0, z: 1 });
        this.updatePipeline.uniforms.uDeltaTime.value = deltaTime;
        this.updatePipeline.uniforms.uUniformMovementView.value = deltaMatrix;
        this.gpuTexturesState.runPipeline(renderer, 'update');
        this.enforceCurrentPositionTexture();
    }

    private enforceCurrentPositionTexture(): void {
        this.displayPipeline.uniforms.uPositionXYTexture.value = this.gpuTexturesState.getCurrentTexture('positionsTexture1');
        this.displayPipeline.uniforms.uPositionZWTexture.value = this.gpuTexturesState.getCurrentTexture('positionsTexture2');
    }
}

export { GpuInstancedBillboard };
