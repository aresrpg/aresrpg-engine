import * as THREE from 'three-usage-test';

import { GpuInstancedBillboard } from '../../lib';

class Snow {
    public readonly container: THREE.Object3D;

    private readonly instancedBillboard: GpuInstancedBillboard;

    private lastCameraPosition: THREE.Vector3 | null = null;

    private lastUpdateTimestamp = performance.now();

    public constructor(renderer: THREE.WebGLRenderer) {
        const particlesCount = 20000;

        this.instancedBillboard = new GpuInstancedBillboard({
            maxInstancesCount: 65000,
            size: { x: 0.2, y: 0.2 },
            speed: 1,
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
}

export { Snow };
