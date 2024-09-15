import * as THREE from "three-usage-test";

import { InstancedBillboard } from "../../lib";

type Particle = {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    birthTimestamp: number;
    lifeDuration: number;
    rotation: number;
};

class Fountain {
    public readonly container: THREE.Object3D;

    private readonly particles: Particle[] = [];

    private readonly instancedBillboard: InstancedBillboard;

    private lastUpdateTimestamp = performance.now();

    public constructor(color: THREE.Color) {
        const particlesCount = 1000;

        this.instancedBillboard = new InstancedBillboard({
            maxInstancesCount: particlesCount,
            rendering: {
                material: "Basic",
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                transparent: true,
                shadows: {
                    receive: false,
                },
                uniforms: {
                    uTexture: {
                        value: new THREE.TextureLoader().load('/resources/fire.jpg', texture => { texture.colorSpace = THREE.SRGBColorSpace; }),
                        type: "sampler2D",
                    },
                },
                attributes: {},
                fragmentCode: `
// vec2 fromCenter = uv - 0.5;
// float distSq = dot(fromCenter, fromCenter);
// if (distSq > 0.2) {
//     discard;
// }
// return (0.25 - distSq) * vec4(${color.r}, ${color.g}, ${color.b}, 1);

vec4 sampled = texture(uTexture, uv);
// if (sampled.r < 0.1) {
//     discard;
// }
const vec3 color = vec3(${color.r}, ${color.g}, ${color.b});
return vec4(color * sampled.r, 1);
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

            const life = (now - particle.birthTimestamp) / particle.lifeDuration;
            const gravity = 3;

            particle.velocity.add({ x: 0, y: -deltaTime * gravity, z: 0 });
            particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));

            let size = 1;
            if (life > 1) {
                size = Math.max(0, 2 - life);
            }

            this.instancedBillboard.setInstancePosition(iP, particle.position);
            this.instancedBillboard.setInstanceTransform(iP, particle.rotation, { x: size, y: size });

            if (life > 2) {
                this.initializeParticle(particle);
            }
        }
    }

    private initializeParticle(particle: Particle): void {
        particle.position = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        particle.velocity = new THREE.Vector3(
            2 * (Math.random() - 0.5),
            -2 * Math.random(),
            2 * (Math.random() - 0.5),
        );
        particle.birthTimestamp = performance.now();
        particle.lifeDuration = 2000 + 3000 * Math.random();
        particle.rotation = 2 * Math.PI * Math.random();
    }
}

export {
    Fountain
};

