import * as THREE from "../libs/three-usage";
import { createFullscreenQuad } from "../helpers/fullscreen-quad";

import type { TerrainViewer } from "./terrain-viewer";

enum EMinimapShape {
    SQUARE = 0,
    ROUND = 1,
}

class Minimap {
    private readonly terrainViewer: TerrainViewer;

    private readonly renderTarget: THREE.WebGLRenderTarget;
    private readonly quad: THREE.Mesh;
    private readonly copyMaterial: THREE.Material;
    private readonly shapeUniform: THREE.IUniform<number>;
    private readonly sizeUniform: THREE.IUniform<number>;
    private readonly orientationUniform: THREE.IUniform<number>;

    private readonly camera: THREE.OrthographicCamera;

    private readonly scene: THREE.Scene;

    public shape = EMinimapShape.ROUND;
    public readonly sizeInPixels = 512;

    public constructor(terrainViewer: TerrainViewer, arrowTexture: THREE.Texture) {
        this.terrainViewer = terrainViewer;

        this.camera = new THREE.OrthographicCamera();
        this.camera.near = .1;
        this.camera.far = 500;

        arrowTexture.wrapS = THREE.ClampToEdgeWrapping;
        arrowTexture.wrapT = THREE.ClampToEdgeWrapping;

        this.scene = new THREE.Scene();
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
        directionalLight.position.set(1, 1, -1);
        directionalLight.target.position.set(0, 0, 0);
        this.scene.add(directionalLight);

        this.renderTarget = new THREE.WebGLRenderTarget(this.sizeInPixels, this.sizeInPixels);
        this.quad = createFullscreenQuad("position");
        this.shapeUniform = { value: this.shape };
        this.sizeUniform = { value: this.sizeInPixels };
        this.orientationUniform = { value: Math.PI / 2 };
        this.copyMaterial = new THREE.RawShaderMaterial({
            glslVersion: "300 es",
            uniforms: {
                uTexture: { value: this.renderTarget.texture },
                uArrowTexture: { value: arrowTexture },
                uOrientation: this.orientationUniform,
                uShape: this.shapeUniform,
                uSize: this.sizeUniform,
            },
            vertexShader: `
            in vec2 position;

            out vec2 vUv;

            void main() {
                gl_Position = vec4(2.0 * position - 1.0, 0, 1);
                vUv = position;
            }`,
            fragmentShader: `
            precision mediump float;
            
            uniform sampler2D uTexture;
            uniform sampler2D uArrowTexture;
            uniform float uOrientation;
            uniform int uShape;
            uniform float uSize;

            in vec2 vUv;
            
            out vec4 fragColor;

            void main() {
                if (uShape == ${EMinimapShape.ROUND}) {
                    if (length(vUv - 0.5) >= 0.5) {
                        discard;
                    }
                }

                vec4 textureSample = texture(uTexture, vUv);
                float arrowUvSize = uSize / 32.0;
                mat2 orientation = mat2(cos(uOrientation), sin(uOrientation), -sin(uOrientation), cos(uOrientation));
                vec2 arrowUv = orientation * arrowUvSize * (vUv - 0.5) + 0.5;
                vec4 arrow = texture(uArrowTexture, arrowUv);

                fragColor = vec4(mix(textureSample.rgb, arrow.rgb, arrow.a), 1);
            }
            `,
        });
        this.quad.material = this.copyMaterial;

        this.setCenter({ x: 0, y: 0 });
        this.radius = 100;
    }

    public setCenter(center: THREE.Vector2Like): void {
        this.camera.position.set(center.x, 500, center.y);
        this.camera.lookAt(center.x, 0, center.y);
    }

    public get radius(): number {
        return this.camera.right;
    }

    public set radius(radius: number) {
        this.camera.left = -radius;
        this.camera.right = +radius;
        this.camera.bottom = -radius;
        this.camera.top = +radius;
        this.camera.updateProjectionMatrix();
    }

    public get orientation(): number {
        return this.orientationUniform.value;
    }

    public set orientation(orientation: number) {
        this.orientationUniform.value = orientation;
    }

    public render(renderer: THREE.WebGLRenderer): void {
        if (this.renderTarget.width !== this.sizeInPixels || this.renderTarget.height !== this.sizeInPixels) {
            this.renderTarget.setSize(this.sizeInPixels, this.sizeInPixels);
        }

        const previousState = {
            color: renderer.getClearColor(new THREE.Color()),
            alpha: renderer.getClearAlpha(),
            renderTarget: renderer.getRenderTarget(),
            autoClear: renderer.autoClear,
            viewport: renderer.getViewport(new THREE.Vector4()),
            sortObjects: renderer.sortObjects,
            terrainViewerParent: this.terrainViewer.container.parent,
        };

        renderer.autoClear = false;

        renderer.setClearColor(0x000000, 1);
        renderer.setRenderTarget(this.renderTarget);

        renderer.clear(true, true);
        this.scene.add(this.terrainViewer.container);
        renderer.render(this.scene, this.camera);

        renderer.sortObjects = false;
        this.shapeUniform.value = this.shape;
        renderer.setRenderTarget(previousState.renderTarget);
        renderer.setViewport(16, 16, this.renderTarget.width, this.renderTarget.height);
        renderer.render(this.quad, this.camera);

        previousState.terrainViewerParent?.add(this.terrainViewer.container);

        renderer.sortObjects = previousState.sortObjects;
        renderer.setClearColor(previousState.color, previousState.alpha);
        renderer.autoClear = previousState.autoClear;
        renderer.setViewport(previousState.viewport);
    }
}

export {
    Minimap
};
