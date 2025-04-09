import * as THREE from 'three-usage-test';

import { BuffAscendEffect, InstancedBillboard, Snow } from '../lib';

import { Fountain } from './effects/fire-fountain';
import { Puff } from './effects/puff';
import { TestBase } from './test-base';

class TestParticles extends TestBase {
    private readonly enableShadows: boolean = true;

    private readonly puff1: Puff;
    private readonly puff2: Puff;
    private readonly fountain: Fountain;
    private readonly snow: Snow;
    private readonly heal: BuffAscendEffect;

    public constructor() {
        super();

        this.camera.position.set(10, 10, 10);
        this.cameraControl.target.set(0, 0, 0);

        this.puff1 = new Puff({
            texture: new THREE.TextureLoader().load('/resources/puff.png', texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
            }),
            size: { x: 3, y: 3 },
        });
        this.puff1.container.position.set(-5.5, 200, 0.5);
        // this.puff1.container.position.set(-5.5, 139.25, 0.5);
        // this.puff1.container.scale.set(0.5, 0.5, 0.5);
        this.scene.add(this.puff1.container);

        this.puff2 = new Puff({
            texture: new THREE.TextureLoader().load('/resources/puff2.png', texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
            }),
            size: { x: 10, y: 1 },
        });
        this.puff2.container.position.set(+5, 200, 0);
        this.scene.add(this.puff2.container);

        this.fountain = new Fountain(new THREE.Color(0xff3311));
        this.fountain.container.position.set(5, 200, -10);
        this.scene.add(this.fountain.container);

        this.snow = new Snow(this.renderer);
        this.snow.container.position.set(40, 170, -40);
        this.scene.add(this.snow.container);

        this.heal = new BuffAscendEffect({
            size: { x: 2, y: 6, z: 2 },
            density: 32,
            animationDuration: 1500,
            texture: new THREE.TextureLoader().load('/resources/heal.png', texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
            }),
        });
        this.heal.container.position.set(0, 200, 0);
        this.scene.add(this.heal.container);

        let healRunning = false;
        window.addEventListener('keydown', event => {
            if (!healRunning && event.code === 'Space') {
                this.heal.start();
                healRunning = true;
            }
        });
        window.addEventListener('keyup', event => {
            if (healRunning && event.code === 'Space') {
                this.heal.stop();
                healRunning = false;
            }
        });
        // setTimeout(() => {
        //     // this.heal.startSingle().then(() => healRunning = false);
        //     this.heal.start();

        //     setTimeout(() => this.heal.stop(), 3000);
        // }, 3000);

        const instancedBillboard = new InstancedBillboard({
            origin: { x: 0, y: -0.5 },
            lockAxis: { x: 0, y: 1, z: 0 },
            rendering: {
                material: 'Phong',
                shadows: { receive: this.enableShadows },
                uniforms: {
                    uTexture: {
                        value: new THREE.TextureLoader().load('/resources/tree.png', texture => {
                            texture.colorSpace = THREE.SRGBColorSpace;
                        }),
                        type: 'sampler2D',
                    },
                },
                attributes: {},
                fragmentCode: `
vec4 sampled = texture(uTexture, uv);
if (sampled.a < 0.5) {
    discard;
}
return vec4(sampled.rgb / sampled.a, 1);
`,
            },
        });
        this.scene.add(instancedBillboard.container);
    }

    protected override update(): void {
        // this.puff1.update();
        // this.puff2.update();
        // this.fountain.update();
        // this.heal.update();

        this.snow.update(this.renderer, this.camera);
    }
}

export { TestParticles };
