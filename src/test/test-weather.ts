import { GUI } from "lil-gui";
import * as THREE from 'three-usage-test';

import { Rain, Snow } from '../lib';

import { TestBase } from "./test-base";

enum EType {
    RAIN = "rain",
    SNOW = "snow",
}

class TestWeather extends TestBase {
    private readonly gui: GUI;

    private readonly parameters = {
        type: EType.SNOW,
        count: 10000,
    };

    private readonly snow: Snow;
    private readonly rain: Rain;

    public constructor() {
        super();

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
        this.gui.add(this.parameters, "type", Object.values(EType)).onChange(() => {
            this.enforceType();
            this.enforceCount();
        });
        this.gui.add(this.parameters, "count", 0, 65000, 1000).onChange(() => { this.enforceCount(); });
        this.enforceCount();
        this.enforceType();
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
}

export { TestWeather };

