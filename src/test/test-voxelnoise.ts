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

                const float baseNoise = 0.5;
                noise *= baseNoise + (1.0 - baseNoise) * smoothstep(0.0, 0.5, distanceFromExtreme);

                baseColor += noise;
                // baseColor = vec3(distanceFromExtreme);
                // baseColor = vec3(noise);
                gl_FragColor = vec4(baseColor, 1);
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
    }

    protected override update(): void {
        // nothing to do
    }
}

export { TestVoxelnoise };
