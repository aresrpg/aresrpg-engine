import * as THREE from 'three-usage-test';
import {GUI} from "lil-gui";

import { TestBase } from "./test-base";
import { Snow } from './effects/snow';

class TestWeather extends TestBase {
    private readonly gui: GUI;

    private readonly parameters = {
        snow: {
            count: 10000,
        },
    };

    private readonly snow: Snow;

    public constructor() {
        super();

        this.camera.position.set(0, 10, 10);
        this.cameraControl.target.set(0, this.camera.position.y - 10, 0);

        const gridHelper = new THREE.GridHelper(1000, 100);
        gridHelper.position.setY(-0.01);
        this.scene.add(gridHelper);

        this.snow = new Snow(this.renderer);
        this.scene.add(this.snow.container);

        this.gui = new GUI();
        const guiFolderSnow = this.gui.addFolder("Snow");
        guiFolderSnow.add(this.parameters.snow, "count", 0, 65000, 1000).onChange(() => {
            this.snow.setParticlesCount(this.parameters.snow.count);
        });
        this.snow.setParticlesCount(this.parameters.snow.count);
    }

    protected override update(): void {
        this.snow.update(this.renderer, this.camera);
    }
}

export { TestWeather };
