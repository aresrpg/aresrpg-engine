import { GUI } from 'lil-gui';
import * as THREE from 'three-usage-test';

import { Rain, Snow } from '../lib';

import { TestBase } from './test-base';

enum EType {
    RAIN = 'rain',
    SNOW = 'snow',
}

class TestWeather extends TestBase {
    private readonly gui: GUI;

    private readonly parameters = {
        type: EType.SNOW,
        count: 10000,
        clippingPlaneLevel: 0,
    };

    private readonly snow: Snow;
    private readonly rain: Rain;

    public constructor() {
        super();

        const ground = this.createGround();
        ground.visible = false;
        this.scene.add(ground);

        this.camera.position.set(0, 10, 10);
        this.cameraControl.target.set(0, this.camera.position.y - 10, 0);

        const gridHelper = new THREE.GridHelper(1000, 100);
        gridHelper.position.setY(-0.01);
        this.scene.add(gridHelper);

        this.snow = new Snow(this.renderer);
        this.scene.add(this.snow.container);

        this.rain = new Rain(this.renderer);
        this.scene.add(this.rain.container);

        this.gui = new GUI();
        this.gui.add(ground, 'visible').name('Display ground');
        this.gui.add(this.parameters, 'type', Object.values(EType)).onChange(() => {
            this.enforceType();
            this.enforceCount();
        });
        this.gui.add(this.parameters, 'count', 0, 65000, 1000).onChange(() => {
            this.enforceCount();
        });
        this.gui.add(this.parameters, 'clippingPlaneLevel', -100, 100).onChange(() => {
            this.enforceClippingPlaneLevel();
        });
        this.enforceCount();
        this.enforceType();
        this.enforceClippingPlaneLevel();
    }

    protected override update(): void {
        if (this.parameters.type === EType.SNOW) {
            this.snow.update(this.renderer, this.camera);
        } else if (this.parameters.type === EType.RAIN) {
            this.rain.update(this.renderer, this.camera);
        } else {
            throw new Error(`Unknown type "${this.parameters.type}".`);
        }
    }

    private enforceType(): void {
        this.snow.container.visible = this.parameters.type === EType.SNOW;
        this.rain.container.visible = this.parameters.type === EType.RAIN;
    }

    private enforceCount(): void {
        this.snow.setParticlesCount(this.parameters.type === EType.SNOW ? this.parameters.count : 0);
        this.rain.setParticlesCount(this.parameters.type === EType.RAIN ? this.parameters.count : 0);
    }

    private enforceClippingPlaneLevel(): void {
        this.snow.clippingPlaneLevel = this.parameters.clippingPlaneLevel;
        this.rain.clippingPlaneLevel = this.parameters.clippingPlaneLevel;
    }

    private createGround(): THREE.Mesh {
        const groundSize = 1000;
        const voxelsInGroundTexture = 20;
        const groundTextureSize = 5 * voxelsInGroundTexture;
        const groundTextureBuffer = new Uint8Array(groundTextureSize * groundTextureSize * 4);
        for (let i = 0; i < groundTextureSize * groundTextureSize; i++) {
            const rand = 255 * (Math.random() - 0.5) * 0.1;
            groundTextureBuffer[4 * i + 0] = THREE.clamp(0 + rand, 0, 255);
            groundTextureBuffer[4 * i + 1] = THREE.clamp(185 + rand, 0, 255);
            groundTextureBuffer[4 * i + 2] = THREE.clamp(20 + rand, 0, 255);
            groundTextureBuffer[4 * i + 3] = 255;
        }
        const groundTexture = new THREE.DataTexture(groundTextureBuffer, groundTextureSize, groundTextureSize);
        groundTexture.needsUpdate = true;
        groundTexture.wrapS = THREE.RepeatWrapping;
        groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.matrix = new THREE.Matrix3().makeScale(groundSize / voxelsInGroundTexture, groundSize / voxelsInGroundTexture);
        groundTexture.matrixAutoUpdate = false;
        groundTexture.minFilter = THREE.LinearMipMapLinearFilter;
        groundTexture.magFilter = THREE.NearestFilter;
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhongMaterial({ map: groundTexture }));
        ground.name = 'ground';
        ground.rotateX(-Math.PI / 2);
        ground.scale.set(groundSize, groundSize, 1);
        return ground;
    }
}

export { TestWeather };
