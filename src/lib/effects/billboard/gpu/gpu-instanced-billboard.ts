import * as THREE from '../../../libs/three-usage';
import { vec3ToString } from '../../../helpers/string';

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

type PositionsTexture = {
    readonly renderTarget: THREE.WebGLRenderTarget;
    readonly xy: THREE.Texture;
    readonly zw: THREE.Texture;
};

class GpuInstancedBillboard {
    public readonly container: THREE.Object3D;

    public readonly positionsRange = new THREE.Vector3(1, 1, 1);

    private static nextId: number = 0;
    private readonly id = GpuInstancedBillboard.nextId++;

    private readonly mesh: THREE.InstancedMesh;

    private readonly fakeCamera = new THREE.PerspectiveCamera();
    private readonly fullscreenQuad: THREE.Mesh;

    private readonly initializePositionsPipeline: {
        readonly shader: THREE.Material;
    };

    private readonly updatePositionsPipeline: {
        readonly shader: THREE.Material;
        readonly uniforms: {
            readonly uUniformMovement: THREE.IUniform<THREE.Vector3Like>;
            readonly uDeltaTime: THREE.IUniform<number>;
            readonly uPreviousPositionsXYTexture: THREE.IUniform<THREE.Texture | null>;
            readonly uPreviousPositionsZWTexture: THREE.IUniform<THREE.Texture | null>;
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
    private readonly positionsTextures: [PositionsTexture, PositionsTexture];
    private currentPositionTextureIndex = 0;

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

        const fullscreenQuadGeometry = new THREE.BufferGeometry();
        fullscreenQuadGeometry.setAttribute('aPosition', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        fullscreenQuadGeometry.setDrawRange(0, 6);
        this.fullscreenQuad = new THREE.Mesh(fullscreenQuadGeometry);
        this.fullscreenQuad.frustumCulled = false;

        this.initializePositionsPipeline = {
            shader: new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                blending: THREE.NoBlending,
                depthTest: false,
                depthWrite: false,
                uniforms: {
                    uNoiseTexture1: { value: this.noiseTextures[0] },
                    uNoiseTexture2: { value: this.noiseTextures[1] },
                },
                vertexShader: `
in vec2 aPosition;

out vec2 vUv;

void main() {
    vUv = aPosition;
    gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
}
            `,
                fragmentShader: `
precision highp float;

uniform sampler2D uNoiseTexture1;
uniform sampler2D uNoiseTexture2;

in vec2 vUv;

layout(location = 0) out vec4 positionXY;
layout(location = 1) out vec4 positionZW;

void main() {
    positionXY = texture(uNoiseTexture1, vUv);
    positionZW = texture(uNoiseTexture2, vUv);
}
`,
            }),
        };

        {
            const updatePositionsUniforms = {
                uUniformMovement: { value: { x: 0, y: 0, z: 0 } },
                uDeltaTime: { value: 0 },
                uPreviousPositionsXYTexture: { value: null },
                uPreviousPositionsZWTexture: { value: null },
            };
            const updatePositionsShader = new THREE.RawShaderMaterial({
                glslVersion: '300 es',
                blending: THREE.NoBlending,
                depthTest: false,
                depthWrite: false,
                uniforms: updatePositionsUniforms,
                vertexShader: `
in vec2 aPosition;

out vec2 vUv;

void main() {
    vUv = aPosition;
    gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
}
            `,
                fragmentShader: `
precision highp float;

uniform vec3 uUniformMovement;
uniform float uDeltaTime;
uniform sampler2D uPreviousPositionsXYTexture;
uniform sampler2D uPreviousPositionsZWTexture;

in vec2 vUv;

layout(location = 0) out vec4 positionXY;
layout(location = 1) out vec4 positionZW;

#include <packing>

void main() {
    vec3 previousPosition = vec3(
        unpackRGBATo2Half(texture(uPreviousPositionsXYTexture, vUv)),
        unpackRGBATo2Half(texture(uPreviousPositionsZWTexture, vUv)).x
    );

    vec3 newPosition = previousPosition + vec3(0, -1, 0) * uDeltaTime + uUniformMovement;
    newPosition = mod(newPosition, vec3(1,1,1));

    positionXY = pack2HalfToRGBA(newPosition.xy);
    positionZW = pack2HalfToRGBA(vec2(newPosition.z, 0));
}
`,
            });

            this.updatePositionsPipeline = {
                shader: updatePositionsShader,
                uniforms: updatePositionsUniforms,
            };
        }

        const createPositionsTextures = (): PositionsTexture => {
            const renderTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, { count: 2, depthBuffer: false });
            return {
                renderTarget,
                xy: renderTarget.textures[0]!,
                zw: renderTarget.textures[1]!,
            };
        };
        this.positionsTextures = [createPositionsTextures(), createPositionsTextures()];

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
            billboardMaterial.side = THREE.DoubleSide;

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
    vec2 positionFromBoxCenter = positionInBox.xz - 0.5;
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
    vec2 localPosition2d = 0.3 * (1.0 - smoothstep(0.24, 0.25, distanceSqFromBoxCenter)) * (position.xy - origin2d);

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

    public get currentPositionTexture(): PositionsTexture {
        return this.positionsTextures[this.currentPositionTextureIndex]!;
    }

    public get nextPositionTexture(): PositionsTexture {
        return this.positionsTextures[(this.currentPositionTextureIndex + 1) % 2]!;
    }

    public initializePositions(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            renderTarget: renderer.getRenderTarget(),
        };

        renderer.setRenderTarget(this.currentPositionTexture.renderTarget);
        this.fullscreenQuad.material = this.initializePositionsPipeline.shader;
        renderer.render(this.fullscreenQuad, this.fakeCamera);
        renderer.setRenderTarget(previousState.renderTarget);
    }

    public updatePositions(renderer: THREE.WebGLRenderer, deltaTime: number, uniformMovement: THREE.Vector3Like): void {
        const previousState = {
            renderTarget: renderer.getRenderTarget(),
        };

        renderer.setRenderTarget(this.nextPositionTexture.renderTarget);
        this.fullscreenQuad.material = this.updatePositionsPipeline.shader;
        this.updatePositionsPipeline.uniforms.uUniformMovement.value = uniformMovement;
        this.updatePositionsPipeline.uniforms.uDeltaTime.value = deltaTime;
        this.updatePositionsPipeline.uniforms.uPreviousPositionsXYTexture.value = this.currentPositionTexture.xy;
        this.updatePositionsPipeline.uniforms.uPreviousPositionsZWTexture.value = this.currentPositionTexture.zw;
        renderer.render(this.fullscreenQuad, this.fakeCamera);
        renderer.setRenderTarget(previousState.renderTarget);

        this.currentPositionTextureIndex = (this.currentPositionTextureIndex + 1) % 2;
        this.enforceCurrentPositionTexture();
    }

    private enforceCurrentPositionTexture(): void {
        const positionsTexture = this.currentPositionTexture;
        this.displayPipeline.uniforms.uPositionXYTexture.value = positionsTexture.xy;
        this.displayPipeline.uniforms.uPositionZWTexture.value = positionsTexture.zw;
    }
}

export { GpuInstancedBillboard };
