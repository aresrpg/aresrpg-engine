import * as THREE from "three-usage-test";

import { InstancedBillboard } from "../../lib";
import { safeModulo } from "../../lib/helpers/math";

type Particle = {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
};

class Rain {
    public readonly container: THREE.Object3D;

    private readonly particles: Particle[] = [];

    private readonly instancedBillboard: InstancedBillboard;
    private readonly orientation: THREE.Vector3Like;

    private lastUpdateTimestamp = performance.now();

    public constructor() {
        const particlesCount = 5000;

        this.orientation = new THREE.Vector3(0, 1, -0.5).normalize();

        this.instancedBillboard = new InstancedBillboard({
            maxInstancesCount: particlesCount,
            lockAxis: { ...this.orientation },
            rendering: {
                material: "Basic",
                shadows: {
                    receive: false,
                },
                uniforms: {},
                attributes: {},
                fragmentCode: `
return vec4(0.5, 0.5, 1, 1);
`,
            }
        });

        this.container = this.instancedBillboard.container;

        for (let i = 0; i < particlesCount; i++) {
            const particle = {
                position: new THREE.Vector3(0, 0, 0),
                velocity: new THREE.Vector3(0, 0, 0),
            };
            this.initializeParticle(particle);
            this.particles.push(particle);
        }
        this.instancedBillboard.setInstancesCount(this.particles.length);
    }

    public update(): void {
        const now = performance.now();
        const deltaTime = (now - this.lastUpdateTimestamp) / 1000;
        this.lastUpdateTimestamp = now;

        for (let iP = 0; iP < this.particles.length; iP++) {
            const particle = this.particles[iP]!;

            particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));

            particle.position.set(
                safeModulo(particle.position.x, 50),
                safeModulo(particle.position.y, 50),
                safeModulo(particle.position.z, 50),
            );

            const size = 0.4;
            this.instancedBillboard.setInstancePosition(iP, particle.position);
            this.instancedBillboard.setInstanceTransform(iP, 0, { x: 0.1 * size, y: 1.5 * size });
        }
    }

    private initializeParticle(particle: Particle): void {
        particle.position = new THREE.Vector3(100 * Math.random(), 100 * Math.random(), 100 * Math.random());
        particle.velocity = new THREE.Vector3(
            this.orientation.x + 0.01 * Math.random(),
            this.orientation.y + 0.01 * Math.random(),
            this.orientation.z + 0.01 * Math.random(),
        ).multiplyScalar(1 + 0.1 * Math.random()).multiplyScalar(-30);
    }
}

export {
    Rain
};

