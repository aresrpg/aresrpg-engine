import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { GrassPatchesBatch } from '../lib';

import { TestBase } from './test-base';

type GrassParticle = {
    readonly position: THREE.Vector2Like;
    visible: boolean;
    lastChangeTimestamp: number;
};

class TestGrass extends TestBase {
    private readonly gui: GUI;

    private readonly grass: GrassPatchesBatch;
    private readonly particles: ReadonlyArray<GrassParticle>;

    private readonly fakeCamera: THREE.Object3D;

    private readonly parameters = {
        viewRadius: 20,
        transitionTime: 0.25,
        centerOnPlayer: true,
    };

    public static async instanciate(): Promise<TestGrass> {
        const gltfLoader = new THREE.GLTFLoader();

        const scene = await gltfLoader.loadAsync('resources/grass-2d.glb');

        let bufferGeometry: THREE.BufferGeometry | null = null;
        scene.scene.traverse(object => {
            if ((object as THREE.Mesh).isMesh) {
                bufferGeometry = (object as THREE.Mesh).geometry;
            }
        });

        if (!bufferGeometry) {
            throw new Error('Failed to load buffer geometry');
        }

        const texture = new THREE.TextureLoader().load("resources/grass-2d.png");
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        const material = new THREE.MeshPhongMaterial({
            map: texture,
            side: THREE.DoubleSide,
            alphaTest: 0.5,
        })

        return new TestGrass(bufferGeometry, material);
    }

    private constructor(bufferGeometry: THREE.BufferGeometry, material: THREE.MeshPhongMaterial) {
        super();

        this.camera.position.set(5, 5, 5);
        this.cameraControl.target.set(0, 1, 0);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 80);
        this.scene.add(dirLight);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        const count = 10000;
        this.grass = new GrassPatchesBatch({
            count,
            bufferGeometry,
            material,
        });
        this.scene.add(this.grass.object3D);

        const particles: GrassParticle[] = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                position: {
                    x: 100 * (Math.random() - 0.5),
                    y: 100 * (Math.random() - 0.5),
                },
                visible: false,
                lastChangeTimestamp: -Infinity,
            });
        }
        this.particles = particles;

        this.particles.forEach((particle: GrassParticle, index: number) => {
            const matrix = new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeTranslation(new THREE.Vector3(particle.position.x, 0, particle.position.y)),
                new THREE.Matrix4().makeRotationY(Math.PI / 2 * Math.random()),//Math.floor(4 * Math.random())),
            );
            this.grass.setMatrix(index, matrix);
        });

        this.fakeCamera = new THREE.Object3D();
        this.fakeCamera.position.set(0, 0.5, 0);
        const boardCenterControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        boardCenterControls.showY = false;
        boardCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        const fakePlayer = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshPhongMaterial({ color: 0xffffff, wireframe: false }));
        this.fakeCamera.add(fakePlayer);
        boardCenterControls.attach(this.fakeCamera);
        this.scene.add(this.fakeCamera);
        this.scene.add(boardCenterControls.getHelper());

        const groundSize = 1000;
        const voxelsInGroundTexture = 20;
        const groundTextureSize = 5 * voxelsInGroundTexture;
        const groundTextureBuffer = new Uint8Array(groundTextureSize * groundTextureSize * 4);
        for (let i = 0; i < groundTextureSize * groundTextureSize; i++) {
            const rand = 255 * (Math.random() - 0.5) * 0.2;
            groundTextureBuffer[4 * i + 0] = THREE.clamp(0 + rand, 0, 255);
            groundTextureBuffer[4 * i + 1] = THREE.clamp(185 + rand, 0, 255);
            groundTextureBuffer[4 * i + 2] = THREE.clamp(20 + rand, 0, 255);
            groundTextureBuffer[4 * i + 3] = 255;
        }
        const groundTexture = new THREE.DataTexture(groundTextureBuffer, groundTextureSize, groundTextureSize);
        groundTexture.needsUpdate = true;
        groundTexture.wrapS = THREE.RepeatWrapping;
        groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.matrix = new THREE.Matrix3().makeScale(groundSize / voxelsInGroundTexture, groundSize / voxelsInGroundTexture);
        groundTexture.matrixAutoUpdate = false;
        groundTexture.minFilter = THREE.LinearMipMapLinearFilter;
        groundTexture.magFilter = THREE.NearestFilter;
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshPhongMaterial({ map: groundTexture }));
        ground.rotateX(-Math.PI / 2);
        ground.scale.set(groundSize, groundSize, 1);
        this.scene.add(ground);

        this.gui = new GUI();
        this.gui.show();
        this.gui.add(this.grass, 'minDissolve', 0, 1, 0.01).name('Min dissolve');
        this.gui.add(this.parameters, 'viewRadius', 0, 200, 1).name('View distance');
        this.gui.add(this.parameters, 'transitionTime', 0, 2, 0.01).name('Transition time');
        this.gui.add(ground, 'visible').name('Show ground');
        this.gui.add(this.parameters, 'centerOnPlayer').name('Center on player');
    }

    protected override update(): void {
        this.fakeCamera.getWorldPosition(this.grass.playerPosition);
        this.grass.update();

        const camera = this.parameters.centerOnPlayer ? this.fakeCamera : this.camera;
        const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
        cameraPosition.setY(0);

        const particlePosition = new THREE.Vector3();
        this.particles.forEach((particle: GrassParticle, index: number) => {
            particlePosition.set(particle.position.x, 0, particle.position.y);

            const shouldBeVisible = cameraPosition.distanceTo(particlePosition) < this.parameters.viewRadius;
            if (particle.visible !== shouldBeVisible) {
                particle.visible = shouldBeVisible;
                particle.lastChangeTimestamp = performance.now();
            }

            this.grass.setDissolve(index, this.getParticleDissolveRatio(particle));
        });
    }

    private getParticleDissolveRatio(particle: GrassParticle): number {
        if (this.parameters.transitionTime <= 0) {
            return 1 - +particle.visible;
        }

        const transitionStep = (0.001 * (performance.now() - particle.lastChangeTimestamp)) / this.parameters.transitionTime;

        if (transitionStep <= 0) {
            return particle.visible ? 1 : 0;
        } else if (transitionStep >= 1) {
            return particle.visible ? 0 : 1;
        } else {
            return particle.visible ? 1 - transitionStep : transitionStep;
        }
    }
}

export { TestGrass };
