import * as THREE from "three-usage-test";

import { InstancedBillboard } from "../../lib";

type Particle = {
    initialPosition: THREE.Vector3;
    birthTimestamp: number;
};

type Parameters = {
    readonly size: THREE.Vector3Like;
    readonly density: number;
    readonly animationDuration: number;
    readonly texture: THREE.Texture;
};

class Heal {
    public readonly container: THREE.Object3D;

    private readonly particles: Particle[] = [];

    private readonly instancedBillboard: InstancedBillboard;

    private readonly animationDuration: number = 2000;
    private readonly maxHeight: number;
    private recycleParticles: boolean = false;

    public constructor(params: Parameters) {
        this.animationDuration = params.animationDuration;
        this.maxHeight = params.size.y;

        const particlesCount = params.density;

        this.instancedBillboard = new InstancedBillboard({
            maxInstancesCount: particlesCount,
            rendering: {
                material: "Basic",
                shadows: {
                    receive: false,
                },
                uniforms: {
                    uTexture: {
                        value: params.texture,
                        type: "sampler2D",
                    },
                },
                attributes: {},
                fragmentCode: `
vec4 sampled = texture(uTexture,uv);
if (sampled.a < 0.5) {
    discard;
}
return vec4(sampled.rgb, 1);
`,
            }
        });

        this.container = this.instancedBillboard.container;

        for (let i = 0; i < particlesCount; i++) {
            const particle = {
                initialPosition: new THREE.Vector3(
                    params.size.x * (Math.random() - 0.5),
                    Math.random(),
                    params.size.z * (Math.random() - 0.5)
                ),
                birthTimestamp: -100000,
            };
            this.particles.push(particle);
        }
        this.instancedBillboard.setInstancesCount(this.particles.length);
    }

    public start(): void {
        for (const particle of this.particles) {
            particle.birthTimestamp = performance.now() + this.animationDuration * Math.random();
        }
        this.recycleParticles = true;
    }

    public stop(): void {
        this.recycleParticles = false;
    }

    public update(): void {
        const now = performance.now();
        const lifetime = this.animationDuration;

        for (let iP = 0; iP < this.particles.length; iP++) {
            const particle = this.particles[iP]!;

            const age = now - particle.birthTimestamp;
            const relativeAge = age / lifetime;
            console.log(relativeAge);
            let size = 0;
            if (age > 0 && age < lifetime) {
                size = 0.5 * Math.sin(Math.PI * relativeAge);
            }
            if (this.recycleParticles && age > lifetime) {
                particle.birthTimestamp += lifetime;
            }

            const position = {
                x: particle.initialPosition.x,
                y: particle.initialPosition.y + this.maxHeight * relativeAge * relativeAge,
                z: particle.initialPosition.z,
            };

            this.instancedBillboard.setInstancePosition(iP, position);
            this.instancedBillboard.setInstanceTransform(iP, 0, { x: size, y: size });
        }
    }
}

export {
    Heal
};

