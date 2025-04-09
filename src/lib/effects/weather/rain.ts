import * as THREE from '../../libs/three-usage';

import { GpuInstancedBillboard } from './weather-particles-base';

class Rain {
    public readonly container: THREE.Object3D;

    private readonly instancedBillboard: GpuInstancedBillboard;
    private readonly uClippingPlaneLevel: THREE.IUniform<number> & { type: 'float' };

    private lastCameraPosition: THREE.Vector3 | null = null;

    private lastUpdateTimestamp = performance.now();

    public constructor(renderer: THREE.WebGLRenderer) {
        const particlesCount = 20000;

        this.uClippingPlaneLevel = {
            value: -Infinity,
            type: 'float',
        };

        const size = 0.4;
        this.instancedBillboard = new GpuInstancedBillboard({
            maxInstancesCount: 65000,
            lockAxis: { x: 0, y: 1, z: 0 },
            size: { x: 0.1 * size, y: 1.5 * size },
            speed: 7,
            rendering: {
                material: 'Basic',
                shadows: {
                    receive: false,
                },
                uniforms: {
                    uClippingPlaneLevel: this.uClippingPlaneLevel,
                },
                fragmentCode: `
if (vFragWorldPosition.y < uClippingPlaneLevel) {
    discard;
}
return vec4(0.5, 0.5, 1, 1);
`,
            },
        });
        this.instancedBillboard.positionsRange.set(100, 100, 100);
        this.instancedBillboard.setInstancesCount(particlesCount);
        this.instancedBillboard.initializePositions(renderer);

        this.container = new THREE.Group();
        this.container.name = 'rain-container';
        this.instancedBillboard.container.position.copy(this.instancedBillboard.positionsRange.clone().multiplyScalar(-0.5));
        this.container.add(this.instancedBillboard.container);
    }

    public update(renderer: THREE.WebGLRenderer, camera: THREE.Object3D): void {
        const now = performance.now();
        const deltaTime = (now - this.lastUpdateTimestamp) / 1000;
        this.lastUpdateTimestamp = now;

        const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
        this.container.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);

        const movement = new THREE.Vector3(0, 0, 0);
        if (this.lastCameraPosition) {
            movement.subVectors(this.lastCameraPosition, cameraPosition);
        }
        this.lastCameraPosition = cameraPosition;

        // limit movement length to avoid floating-point precision issues
        const maxMovementLength = 100;
        const movementLength = movement.length();
        if (movementLength > maxMovementLength) {
            movement.multiplyScalar(maxMovementLength / movementLength);
        }

        this.instancedBillboard.updatePositions(renderer, deltaTime / 20, {
            x: movement.x / this.instancedBillboard.positionsRange.x,
            y: movement.y / this.instancedBillboard.positionsRange.y,
            z: movement.z / this.instancedBillboard.positionsRange.z,
        });
    }

    public setParticlesCount(value: number): void {
        this.instancedBillboard.setInstancesCount(value);
    }

    public get clippingPlaneLevel(): number {
        return this.uClippingPlaneLevel.value;
    }

    public set clippingPlaneLevel(value: number) {
        this.uClippingPlaneLevel.value = value;
    }
}

export { Rain };
