import * as THREE from "three-usage-test";

import { InstancedBillboard, type Spritesheet } from "../../lib";

type Particle = {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    birthTimestamp: number;
    lifeDuration: number;
    initialRotation: number;
    rotationSpeed: number;
};

class Puff {
    public readonly container: THREE.Object3D;

    private readonly particles: Particle[] = [];

    private readonly instancedBillboard: InstancedBillboard;

    private lastUpdateTimestamp = performance.now();

    public constructor(spritesheet: Spritesheet) {
        const particlesCount = 15;

        this.instancedBillboard = new InstancedBillboard({
            maxInstancesCount: particlesCount,
            rendering: {
                material: "Basic",
                shadows: {
                    receive: false,
                },
                uniforms: {
                    uSpriteTexture: {
                        value: spritesheet.texture,
                        type: "sampler2D",
                    },
                },
                attributes: {
                    life: { type: "float" },
                },
                fragmentCode: `
if (life > 1.0) {
    discard;
}

float spriteId = life * ${(spritesheet.size.x * spritesheet.size.y).toFixed(1)};
vec2 spriteUv = vec2(
    floor(mod(spriteId, ${spritesheet.size.x.toFixed(1)})),
    floor(spriteId / ${spritesheet.size.x.toFixed(1)})
    ) + uv;
spriteUv /= vec2(${spritesheet.size.x}, ${spritesheet.size.y});

vec4 sampled = texture(uSpriteTexture, vec2(spriteUv.x, 1.0 - spriteUv.y));
if (sampled.a < 0.5) {
    discard;
}
return vec4(sampled.rgb, 1);
`,
            }
        });

        this.container = this.instancedBillboard.container;

        for (let i = 0; i < particlesCount; i++) {
            const angle = i * 2 * Math.PI / particlesCount;
            this.particles.push({
                position: new THREE.Vector3(0, 0, 0),
                velocity: new THREE.Vector3(
                    Math.cos(angle),
                    0.2 * Math.random(),
                    Math.sin(angle),
                ),
                birthTimestamp: performance.now(),
                lifeDuration: 750,
                initialRotation: Math.random() * 2 * Math.PI,
                rotationSpeed: 2.0 * (Math.random() - 0.5),
            });
        }
        this.instancedBillboard.setInstancesCount(this.particles.length);
    }

    public update(): void {
        const now = performance.now();
        const deltaTime = (this.lastUpdateTimestamp - now) / 1000;
        this.lastUpdateTimestamp = now;

        for (let iP = 0; iP < this.particles.length; iP++) {
            const particle = this.particles[iP]!;

            const life = (now - particle.birthTimestamp) / particle.lifeDuration;
            const lifeSq = life * life;

            if (life < 2) {
                particle.position.add(particle.velocity.clone().multiplyScalar(8 * deltaTime * (1 - lifeSq)));

                const size = 2 + 0.5 * lifeSq * lifeSq;
                const rotation = particle.initialRotation + particle.rotationSpeed * life;

                this.instancedBillboard.setInstanceCustomAttribute(iP, "life", [life]);
                this.instancedBillboard.setInstancePosition(iP, particle.position);
                this.instancedBillboard.setInstanceTransform(iP, rotation, { x: size, y: size });
            } else {
                particle.birthTimestamp = now;
                particle.position.set(0, 0, 0);
                this.instancedBillboard.setInstanceCustomAttribute(iP, "life", [0]);
                this.instancedBillboard.setInstancePosition(iP, particle.position);
                this.instancedBillboard.setInstanceTransform(iP, 0, { x: 0, y: 0 });
            }
        }
    }
}

export {
    Puff
};

