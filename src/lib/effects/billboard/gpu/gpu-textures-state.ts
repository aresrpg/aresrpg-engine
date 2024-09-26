import * as THREE from '../../../libs/three-usage';

type UniformType = 'sampler2D' | 'float' | 'vec2' | 'vec3' | 'vec4';
type Uniforms = Record<string, THREE.IUniform<unknown> & { readonly type: UniformType }>;
type PipelineParameters = {
    readonly uniforms: Uniforms;
    readonly requiresPreviousState: boolean;
    readonly shaderCode: string;
};
type Parameters = {
    readonly width: number;
    readonly height: number;
    readonly textureNames: ReadonlyArray<string>;

    readonly pipelines: Record<string, PipelineParameters>;
};

type Pipeline = {
    readonly requiresPreviousState: boolean;
    readonly shader: THREE.RawShaderMaterial;
};

class GpuTexturesState {
    private readonly fullscreenQuad: THREE.Mesh;
    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly textureNames: ReadonlyArray<string>;
    private readonly renderTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    private currentRenderTargetId: number = 0;

    private readonly pipelines: Record<string, Pipeline> = {};

    public constructor(params: Parameters) {
        this.renderTargets = [
            new THREE.WebGLRenderTarget(params.width, params.height, { count: params.textureNames.length, depthBuffer: false }),
            new THREE.WebGLRenderTarget(params.width, params.height, { count: params.textureNames.length, depthBuffer: false }),
        ];

        this.textureNames = params.textureNames;

        const fullscreenQuadGeometry = new THREE.BufferGeometry();
        fullscreenQuadGeometry.setAttribute('aPosition', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        fullscreenQuadGeometry.setDrawRange(0, 6);
        this.fullscreenQuad = new THREE.Mesh(fullscreenQuadGeometry);
        this.fullscreenQuad.frustumCulled = false;

        const vertexShader = `
in vec2 aPosition;

out vec2 vUv;

void main() {
    vUv = aPosition;
    gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
}`;

        const buildUniformsCode = (uniforms: Uniforms): string => {
            return Object.entries(uniforms)
                .map(([name, uniform]) => `uniform ${uniform.type} ${name};`)
                .join('\n');
        };

        for (const [name, definition] of Object.entries(params.pipelines)) {
            const uniforms: Uniforms = { ...definition.uniforms };

            let fragmentShader: string;
            if (definition.requiresPreviousState) {
                for (const textureName of params.textureNames) {
                    uniforms[`uPreviousState_${textureName}`] = { value: null, type: 'sampler2D' };
                }
                fragmentShader = `
precision highp float;

${buildUniformsCode(uniforms)}

in vec2 vUv;

${params.textureNames.map((_name: string, index: number) => `layout(location = ${index}) out vec4 out_fragColor${index};`).join('\n')}

#include <packing>

void runPipeline(
${['const vec2 uv', ...params.textureNames.map(name => `const vec4 in_${name}`), ...params.textureNames.map(name => `out vec4 out_${name}`)]
    .map(name => `\t${name}`)
    .join(',\n')}
) {
    ${definition.shaderCode}
}

void main() {
    runPipeline(
${[
    'vUv',
    ...params.textureNames.map(name => `texture(uPreviousState_${name}, vUv)`),
    ...params.textureNames.map((_name: string, index: number) => `out_fragColor${index}`),
]
    .map(name => `\t\t${name}`)
    .join(',\n')}
    );
}`;
            } else {
                fragmentShader = `
precision highp float;

${buildUniformsCode(uniforms)}

in vec2 vUv;

${params.textureNames.map((_name: string, index: number) => `layout(location = ${index}) out vec4 out_fragColor${index};`).join('\n')}

#include <packing>

void runPipeline(
${['const vec2 uv', ...params.textureNames.map(name => `out vec4 out_${name}`)].map(name => `\t${name}`).join(',\n')}
) {
    ${definition.shaderCode}
}

void main() {
    runPipeline(
${['vUv', ...params.textureNames.map((_name: string, index: number) => `out_fragColor${index}`)].map(name => `\t\t${name}`).join(',\n')}
    );
}`;
            }

            this.pipelines[name] = {
                shader: new THREE.RawShaderMaterial({
                    glslVersion: '300 es',
                    blending: THREE.NoBlending,
                    depthTest: false,
                    depthWrite: false,
                    uniforms,
                    vertexShader,
                    fragmentShader,
                }),
                requiresPreviousState: definition.requiresPreviousState,
            };
        }
    }

    public runPipeline(renderer: THREE.WebGLRenderer, name: string): void {
        const pipeline = this.pipelines[name];
        if (!pipeline) {
            throw new Error(`Unknown pipeline "${name}".`);
        }

        const previousState = {
            renderTarget: renderer.getRenderTarget(),
        };

        if (pipeline.requiresPreviousState) {
            const currentRenderTarget = this.currentRenderTarget;
            this.textureNames.forEach((name: string, index: number) => {
                pipeline.shader.uniforms[`uPreviousState_${name}`]!.value = currentRenderTarget.textures[index]!;
            });
        }
        this.fullscreenQuad.material = pipeline.shader;
        renderer.setRenderTarget(this.nextRenderTarget);
        renderer.render(this.fullscreenQuad, this.fakeCamera);
        renderer.setRenderTarget(previousState.renderTarget);

        this.currentRenderTargetId = (this.currentRenderTargetId + 1) % 2;
    }

    public getCurrentTexture(name: string): THREE.Texture {
        const index = this.textureNames.indexOf(name);
        if (index < 0) {
            throw new Error(`Unknown texture "${name}".`);
        }
        return this.currentRenderTarget.textures[index]!;
    }

    private get currentRenderTarget(): THREE.WebGLRenderTarget {
        return this.renderTargets[this.currentRenderTargetId]!;
    }

    private get nextRenderTarget(): THREE.WebGLRenderTarget {
        return this.renderTargets[(this.currentRenderTargetId + 1) % 2]!;
    }
}

export { GpuTexturesState };
