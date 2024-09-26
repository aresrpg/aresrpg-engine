import * as THREE from '../../../libs/three-usage';
import { vec3ToString } from '../../../helpers/string';

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

    private static nextId: number = 0;
    private readonly id = GpuInstancedBillboard.nextId++;

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

        const textureSize = 256;
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

        const spriteOrigin = params.origin ?? { x: 0, y: 0 };

        function applyReplacements(source: string, replacements: Record<string, string>): string {
            let result = source;

            for (const [source, replacement] of Object.entries(replacements)) {
                result = result.replace(source, replacement);
            }

            return result;
        }

        {
            const displayPipelineUniforms = {
                uPositionXYTexture: { value: null },
                uPositionZWTexture: { value: null },
                uPositionsRange: { value: this.positionsRange },
            };

            let billboardMaterial: THREE.Material;
            if (params.rendering.material === 'Phong') {
                billboardMaterial = new THREE.MeshPhongMaterial();
                // billboardMaterial.shininess = 0;
            } else if (params.rendering.material === 'Basic') {
                billboardMaterial = new THREE.MeshBasicMaterial();
            } else {
                throw new Error(`Unsupported material "${params.rendering.material}".`);
            }
            billboardMaterial.blending = params.rendering.blending ?? THREE.NormalBlending;
            billboardMaterial.depthWrite = params.rendering.depthWrite ?? true;
            billboardMaterial.transparent = params.rendering.transparent ?? false;

            billboardMaterial.customProgramCacheKey = () => `gpu_billboard_material_${this.id}`;
            billboardMaterial.onBeforeCompile = parameters => {
                parameters.uniforms = {
                    ...parameters.uniforms,
                    ...params.rendering.uniforms,
                    ...displayPipelineUniforms,
                };

                parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                    'void main() {': `
uniform sampler2D uPositionXYTexture;
uniform sampler2D uPositionZWTexture;
uniform vec3 uPositionsRange;

varying vec2 vUv;

#include <packing>

void main() {
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
    vec3 instanceWorldPosition = uPositionsRange * positionInBox;
    vec3 positionFromBoxCenter = positionInBox - 0.5;
    float distanceSqFromBoxCenter = dot(positionFromBoxCenter, positionFromBoxCenter);

    vec3 up = ${
        params.lockAxis
            ? `vec3(${vec3ToString(new THREE.Vector3().copy(params.lockAxis).normalize(), ', ')})`
            : 'normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]))'
    };
    vec4 billboardOriginWorld = modelMatrix * vec4(instanceWorldPosition, 1);
    vec3 lookVector = normalize(cameraPosition - billboardOriginWorld.xyz / billboardOriginWorld.w);
    vec3 right = normalize(cross(lookVector, up));
`,
                    '#include <begin_vertex>': `
    const vec2 origin2d = vec2(${spriteOrigin.x.toFixed(3)}, ${spriteOrigin.y.toFixed(3)});
    vec2 localPosition2d = 0.3 * (1.0 - smoothstep(0.23, 0.25, distanceSqFromBoxCenter)) * (position.xy - origin2d);

    vec3 transformed = instanceWorldPosition + localPosition2d.x * right + localPosition2d.y * up;

    vUv = uv;
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

uniform sampler2D uNoiseTexture;

vec4 getColor(const vec2 uv) {
    ${params.rendering.fragmentCode}
}

void main() {`,
                    '#include <map_fragment>': `
    diffuseColor.rgb = getColor(vUv).rgb;
`,
                });
            };
            this.displayPipeline = {
                shader: billboardMaterial,
                uniforms: displayPipelineUniforms,
            };
        }

        {
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
