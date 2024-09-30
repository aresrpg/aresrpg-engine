import * as THREE from "../libs/three-usage";

import { createFullscreenQuad } from "./fullscreen-quad";

type Parameters = {
    readonly width: number;
    readonly height: number;
    readonly baseTexture: THREE.Texture;
    readonly additionalTextures: ReadonlyMap<string, THREE.Texture>;
};

type TextureLayer = {
    readonly texture: THREE.Texture;
    readonly color: THREE.Color;
};

class CustomizableTexture {
    public readonly texture: THREE.Texture;

    private readonly baseTexture: THREE.Texture;
    private readonly layers: ReadonlyMap<string, TextureLayer>;

    private readonly renderTarget: THREE.WebGLRenderTarget;
    private readonly fakeCamera = new THREE.PerspectiveCamera();
    private readonly fullscreenQuad = createFullscreenQuad("aPosition");
    private readonly applyLayer: {
        readonly shader: THREE.RawShaderMaterial;
        readonly uniforms: {
            readonly layer: THREE.IUniform<THREE.Texture | null>;
            readonly color: THREE.IUniform<THREE.Color>;
        };
    };

    public constructor(params: Parameters) {
        this.baseTexture = params.baseTexture;

        const layers = new Map<string, TextureLayer>();
        for (const [name, texture] of params.additionalTextures.entries()) {
            layers.set(name, { texture, color: new THREE.Color(0xFFFFFF) });
        }
        this.layers = layers;

        this.renderTarget = new THREE.WebGLRenderTarget(params.width, params.height, {
            depthBuffer: false,
        });
        const texture = this.renderTarget.textures[0];
        if (!texture) {
            throw new Error(`Cannot get texture from rendertarget`);
        }
        this.texture = texture;

        const uniforms = {
            layer: { value: null },
            color: { value: new THREE.Color(0xFFFFFF) },
        };

        const shader = new THREE.RawShaderMaterial({
            glslVersion: "300 es",
            uniforms: {
                uLayerTexture: uniforms.layer,
                uLayerColor: uniforms.color,
            },
            vertexShader: `
in vec2 aPosition;

out vec2 vUv;

void main() {
    vUv = aPosition;
    gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
}`,
            fragmentShader: `
precision mediump float;

uniform sampler2D uLayerTexture;
uniform vec3 uLayerColor;

in vec2 vUv;

(layout location = 0) out vec4 fragColor;

void main() {
    vec4 sample = texture(uLayerTexture, vUv);
    // sample.rgb *= uLayerColor;
    fragColor = sample + vec4(0, 1, 0, 1);
}
`,
        });

        this.applyLayer = { shader, uniforms };
    }

    public setLayerColor(layerName: string, color: THREE.Color): void {
        const layer = this.layers.get(layerName);
        if (!layer) {
            const layerNames = Array.from(this.layers.keys());
            throw new Error(`Unknown layer name "${layerName}". Layer names are: ${layerNames.join("; ")}.`);
        }

        if (layer.color.equals(color)) {
            return; // nothing to do
        }

        layer.color.set(color);
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
        renderer.setClearColor(0xFF0000, 0);
        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.clear(true);

        this.applyLayer.uniforms.layer.value = this.baseTexture;
        this.applyLayer.uniforms.color.value = new THREE.Color(0xFFFFFF);
        renderer.render(this.fullscreenQuad, this.fakeCamera);

        // for (const layer of this.layers.values()) {
        //     this.applyLayer.uniforms.layer.value = layer.texture;
        //     this.applyLayer.uniforms.color.value = layer.color;
        //     renderer.render(this.fullscreenQuad, this.fakeCamera);
        // }

        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setClearColor(previousState.clearColor);
        renderer.setClearAlpha(previousState.clearAlpha);
        renderer.autoClear = previousState.autoClear;
        renderer.autoClearColor = previousState.autoClearColor;
    }
}

export {
    CustomizableTexture
};

