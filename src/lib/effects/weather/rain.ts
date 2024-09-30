import * as THREE from '../../libs/three-usage';

import { GpuInstancedBillboard } from './weather-particles-base';

class Rain {
    public readonly container: THREE.Object3D;

    private readonly instancedBillboard: GpuInstancedBillboard;

    public constructor(renderer: THREE.WebGLRenderer) {
        const particlesCount = 20000;

        const size = 0.2;
        this.instancedBillboard = new GpuInstancedBillboard({
            maxInstancesCount: 65000,
            maxDistance: 20,
            lockAxis: { x: 0, y: 1, z: 0 },
            size: { x: 0.1 * size, y: 1.5 * size },
            speed: 7 / 20,
            rendering: {
                material: 'Basic',
                shadows: {
                    receive: false,
                },
                uniforms: {},
                fragmentCode: `
return vec4(0.5, 0.5, 1, 1);
`,
            },
        });
        this.instancedBillboard.setInstancesCount(particlesCount);
        this.instancedBillboard.initializePositions(renderer);

        this.container = new THREE.Group();
        this.container.add(this.instancedBillboard.container);
    }

    public update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
        this.instancedBillboard.updatePositions(renderer, camera);
    }

    public setParticlesCount(value: number): void {
        this.instancedBillboard.setInstancesCount(value);
    }
}

export { Rain };
