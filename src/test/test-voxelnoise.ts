import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { TestBase } from './test-base';

class TestVoxelnoise extends TestBase {
    private readonly gui: GUI;

    public constructor() {
        super();

        this.camera.position.set(0, 35, 0);
        this.cameraControl.target.set(0, 1, 0);

        const groundSize = 50;
        const voxelsInGroundTexture = 20;
        const groundTextureSize = 5 * voxelsInGroundTexture;
        const groundTextureBuffer = new Uint8Array(groundTextureSize * groundTextureSize * 4);
        for (let i = 0; i < groundTextureSize * groundTextureSize; i++) {
            groundTextureBuffer[4 * i + 0] = Math.floor(255 * Math.random());
            groundTextureBuffer[4 * i + 1] = Math.floor(255 * Math.random());
            groundTextureBuffer[4 * i + 2] = Math.floor(255 * Math.random());
            groundTextureBuffer[4 * i + 3] = 255;
        }
        const noiseTexture = new THREE.DataTexture(groundTextureBuffer, groundTextureSize, groundTextureSize);
        noiseTexture.needsUpdate = true;
        noiseTexture.wrapS = THREE.RepeatWrapping;
        noiseTexture.wrapT = THREE.RepeatWrapping;
        noiseTexture.matrix = new THREE.Matrix3().makeScale(groundSize / voxelsInGroundTexture, groundSize / voxelsInGroundTexture);
        noiseTexture.matrixAutoUpdate = false;
        noiseTexture.minFilter = THREE.LinearMipMapLinearFilter;
        noiseTexture.magFilter = THREE.NearestFilter;

        const colorUniform = { value: new THREE.Color(0xff0000) };
        const noiseStrengthUniform = { value: 0.2 };
        const baseNoiseUniform = { value: 0.45 };
        const displayColorsUniform = { value: 1 };
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uNoiseTexture: { value: noiseTexture },
                uColorTexture: {
                    value: new THREE.TextureLoader().load('./resources/all_colors.png', texture => {
                        texture.magFilter = THREE.NearestFilter;
                        texture.minFilter = THREE.NearestFilter;
                    }),
                },
                uColor: colorUniform,
                uNoiseStrength: noiseStrengthUniform,
                uBaseNoise: baseNoiseUniform,
                uColorsIntensity: displayColorsUniform,
            },
            vertexShader: `
            varying vec2 vUv;
            void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
                vUv = position.xy + 0.5;
            }
            `,
            fragmentShader: `precision mediump float;
            
            uniform sampler2D uNoiseTexture;
            uniform sampler2D uColorTexture;
            uniform vec3 uColor;
            uniform float uNoiseStrength;
            uniform float uBaseNoise;
            uniform float uColorsIntensity;

            varying vec2 vUv;

            void main() {
                gl_FragColor = vec4(vUv, 0, 1);

                vec4 colorSample = texture(uColorTexture, vUv);
                vec3 baseColor = mix(uColor, colorSample.rgb, colorSample.a);
               
                float noise = texture(uNoiseTexture, vUv).r - 0.5;
                noise *= uNoiseStrength;

                float distanceFromBlack = length(baseColor);
                float distanceFromWhite = length(baseColor - 1.0);
                float distanceFromExtreme = min(distanceFromBlack, distanceFromWhite);

                noise *= mix(uBaseNoise, 1.0, smoothstep(0.1, ${Math.sqrt(3)}, distanceFromExtreme));

                baseColor += noise;
                gl_FragColor = vec4(
                    mix(vec3(noise), baseColor, uColorsIntensity),
                    1
                );
            }
            `,
        });
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        ground.name = 'ground';
        ground.rotateX(-Math.PI / 2);
        ground.scale.set(groundSize, groundSize, 1);
        this.scene.add(ground);

        this.gui = new GUI();
        this.gui.show();
        this.gui.addColor(colorUniform, 'value').name('Color');
        this.gui.add(noiseStrengthUniform, 'value', 0, 1, 0.01).name('Noise strength');
        this.gui.add(baseNoiseUniform, 'value', 0, 1, 0.01).name('Noise for black/white');
        this.gui.add(displayColorsUniform, "value", 0, 1, 0.1).name("Colors intensity");
    }

    protected override update(): void {
        // nothing to do
    }
}

export { TestVoxelnoise };
