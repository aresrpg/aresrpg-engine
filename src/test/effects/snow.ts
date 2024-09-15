import * as THREE from "three-usage-test";

import { InstancedBillboard } from "../../lib";
import { safeModulo } from "../../lib/helpers/math";

type Particle = {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
};

class Snow {
    public readonly container: THREE.Object3D;

    private readonly particles: Particle[] = [];

    private readonly instancedBillboard: InstancedBillboard;

    private lastUpdateTimestamp = performance.now();

    public constructor() {
        const particlesCount = 3000;

        this.instancedBillboard = new InstancedBillboard({
            maxInstancesCount: particlesCount,
            rendering: {
                material: "Basic",
                shadows: {
                    receive: false,
                },
                uniforms: {},
                attributes: {},
                fragmentCode: `
vec2 fromCenter = uv - 0.5;
float distSq = dot(fromCenter, fromCenter);
if (distSq > 0.2) {
    discard;
}
return vec4(0.9, 0.9, 1, 1);
`,
            }
        });

        this.container = this.instancedBillboard.container;

        for (let i = 0; i < particlesCount; i++) {
            const particle = {
                position: new THREE.Vector3(0, 0, 0),
                velocity: new THREE.Vector3(0, 0, 0),
                birthTimestamp: 0,
                lifeDuration: 0,
                rotation: 0,
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

            const size = 0.2;
            this.instancedBillboard.setInstancePosition(iP, particle.position);
            this.instancedBillboard.setInstanceTransform(iP, 0, { x: size, y: size });
        }
    }

    private initializeParticle(particle: Particle): void {
        particle.position = new THREE.Vector3(100 * Math.random(), 100 *  Math.random(), 100 * Math.random());
        particle.velocity = new THREE.Vector3(
            -0.5 + 0.1 * Math.random(),
            -1 - 3 * Math.random(),
            -0.5 + 0.1 * Math.random(),
        );
    }
}

export {
    Snow
};

