import * as THREE from '../../libs/three-usage';

import { GpuInstancedBillboard } from './weather-particles-base';

class Snow {
    public readonly container: THREE.Object3D;

    private readonly instancedBillboard: GpuInstancedBillboard;

    public constructor(renderer: THREE.WebGLRenderer) {
        const particlesCount = 20000;

        this.instancedBillboard = new GpuInstancedBillboard({
            maxInstancesCount: 65000,
            size: { x: 0.2, y: 0.2 },
            speed: 1 / 20,
            rendering: {
                material: 'Basic',
                shadows: {
                    receive: false,
                },
                uniforms: {},
                fragmentCode: `
vec2 fromCenter = uv - 0.5;
float distSq = dot(fromCenter, fromCenter);
if (distSq > 0.24) {
    discard;
}
return vec4(0.9, 0.9, 1, 1);
`,
            },
        });
        this.instancedBillboard.positionsRange.set(100, 100, 100);
        this.instancedBillboard.setInstancesCount(particlesCount);
        this.instancedBillboard.initializePositions(renderer);

        this.container = new THREE.Group();
        this.instancedBillboard.container.position.copy(this.instancedBillboard.positionsRange.clone().multiplyScalar(-0.5));
        this.container.add(this.instancedBillboard.container);
    }

    public update(renderer: THREE.WebGLRenderer, camera: THREE.Object3D): void {
        this.instancedBillboard.updatePositions(renderer, camera);
    }

    public setParticlesCount(value: number): void {
        this.instancedBillboard.setInstancesCount(value);
    }
}

export { Snow };
