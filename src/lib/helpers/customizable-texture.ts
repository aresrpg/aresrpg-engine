import * as THREE from '../libs/three-usage';

import { createFullscreenQuad } from './fullscreen-quad';
import { logger } from './logger';

type Parameters = {
    readonly baseTexture: THREE.Texture;
    readonly additionalTextures: ReadonlyMap<string, THREE.Texture>;
};

type TextureLayer = {
    readonly texture: THREE.Texture;
    readonly color: THREE.Color;
};

class CustomizableTexture {
    public readonly texture: THREE.Texture;

    public needsUpdate: boolean = true;
    public get layerNames(): ReadonlyArray<string> {
        return Array.from(this.layers.keys());
    }

    private readonly baseTexture: THREE.Texture;
    private readonly layers: ReadonlyMap<string, TextureLayer>;

    private readonly renderTarget: THREE.WebGLRenderTarget;
    private readonly fakeCamera = new THREE.PerspectiveCamera();
    private readonly fullscreenQuad = createFullscreenQuad('aPosition');
    private readonly applyLayer: {
        readonly shader: THREE.RawShaderMaterial;
        readonly uniforms: {
            readonly layer: THREE.IUniform<THREE.Texture | null>;
            readonly color: THREE.IUniform<THREE.Color>;
            readonly flipY: THREE.IUniform<number>;
        };
    };

    public constructor(params: Parameters) {
        this.baseTexture = params.baseTexture;

        this.renderTarget = new THREE.WebGLRenderTarget(this.baseTexture.image.width, this.baseTexture.image.height, {
            wrapS: this.baseTexture.wrapS,
            wrapT: this.baseTexture.wrapT,
            magFilter: this.baseTexture.magFilter,
            // minFilter: this.baseTexture.minFilter,
            depthBuffer: false,
        });
        const texture = this.renderTarget.textures[0];
        if (!texture) {
            throw new Error(`Cannot get texture from rendertarget`);
        }
        this.texture = texture;

        const layers = new Map<string, TextureLayer>();
        for (const [name, texture] of params.additionalTextures.entries()) {
            if (texture.image.width !== this.renderTarget.width || texture.image.height !== this.renderTarget.height) {
                logger.warn(
                    `Invalid texture size: expected "${this.renderTarget.width}x${this.renderTarget.height}" but received "${texture.image.width}x${texture.image.height}".`
                );
            }
            layers.set(name, { texture, color: new THREE.Color(0xffffff) });
        }
        this.layers = layers;

        const uniforms = {
            layer: { value: null },
            color: { value: new THREE.Color(0xffffff) },
            flipY: { value: 0 },
        };

        const shader = new THREE.RawShaderMaterial({
            glslVersion: '300 es',
            depthTest: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
            uniforms: {
                uLayerTexture: uniforms.layer,
                uLayerColor: uniforms.color,
                uFlipY: uniforms.flipY,
            },
            vertexShader: `
uniform float uFlipY;

in vec2 aPosition;

out vec2 vUv;

void main() {
    gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
    vUv = vec2(
        aPosition.x,
        mix(aPosition.y, 1.0 - aPosition.y, uFlipY)
    );
}`,
            fragmentShader: `
precision mediump float;

uniform sampler2D uLayerTexture;
uniform vec3 uLayerColor;

in vec2 vUv;

layout(location = 0) out vec4 fragColor;

void main() {
    vec4 sampled = texture(uLayerTexture, vUv);
    if (sampled.a < 0.5) discard;
    sampled.rgb *= uLayerColor;
    fragColor = sampled;
}
`,
        });
        this.fullscreenQuad.material = shader;

        this.applyLayer = { shader, uniforms };
    }

    public setLayerColor(layerName: string, color: THREE.Color): void {
        const layer = this.layers.get(layerName);
        if (!layer) {
            throw new Error(`Unknown layer name "${layerName}". Layer names are: ${this.layerNames.join('; ')}.`);
        }

        if (layer.color.equals(color)) {
            return; // nothing to do
        }

        layer.color.set(color);
        this.needsUpdate = true;
    }

    public getLayerColor(layerName: string): THREE.Color {
        const layer = this.layers.get(layerName);
        if (!layer) {
            throw new Error(`Unknown layer name "${layerName}". Layer names are: ${this.layerNames.join('; ')}.`);
        }

        return layer.color.clone();
    }

    public update(renderer: THREE.WebGLRenderer): void {
        const previousState = {
            renderTarget: renderer.getRenderTarget(),
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            autoClear: renderer.autoClear,
            autoClearColor: renderer.autoClearColor,
        };

        renderer.setRenderTarget(this.renderTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.clear(true);

        this.applyLayer.uniforms.layer.value = this.baseTexture;
        this.applyLayer.uniforms.color.value = new THREE.Color(0xffffff);
        this.applyLayer.uniforms.flipY.value = Number(this.baseTexture.flipY);
        this.applyLayer.shader.uniformsNeedUpdate = true;
        renderer.render(this.fullscreenQuad, this.fakeCamera);

        for (const layer of this.layers.values()) {
            this.applyLayer.uniforms.layer.value = layer.texture;
            this.applyLayer.uniforms.color.value = layer.color;
            this.applyLayer.uniforms.flipY.value = Number(layer.texture.flipY);
            this.applyLayer.shader.uniformsNeedUpdate = true;
            renderer.render(this.fullscreenQuad, this.fakeCamera);
        }

        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setClearColor(previousState.clearColor);
        renderer.setClearAlpha(previousState.clearAlpha);
        renderer.autoClear = previousState.autoClear;
        renderer.autoClearColor = previousState.autoClearColor;

        this.needsUpdate = false;
    }

    public dispose() {
        this.renderTarget.dispose();
        this.fullscreenQuad.geometry.dispose();
    }
}

export { CustomizableTexture };
