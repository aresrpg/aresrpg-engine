import * as THREE from 'three-usage-test';

import { TestBase } from "./test-base";
import { Snow } from './effects/snow';

class TestWeather extends TestBase {
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
    }

    protected override update(): void {
        this.snow.update(this.renderer, this.camera);
    }
}

export { TestWeather };
