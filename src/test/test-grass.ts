import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { GrassPatchesBatch } from '../lib';

import { TestBase } from './test-base';

type GrassParticle = {
    readonly position: THREE.Vector2Like;
    visible: boolean;
    lastChangeTimestamp: number;
};

type ClutterDefinition = {
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
};

function extractBufferGeometry(object: THREE.Object3D): THREE.BufferGeometry {
    let bufferGeometry: THREE.BufferGeometry | null = null;
    object.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
            bufferGeometry = (child as THREE.Mesh).geometry;
        }
    });

    if (!bufferGeometry) {
        throw new Error('Failed to load buffer geometry');
    }
    return bufferGeometry;
}

async function getGrass2D(gltfLoader: THREE.GLTFLoader): Promise<ClutterDefinition> {
    const glb = await gltfLoader.loadAsync('resources/grass-2d.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);

    const texture = new THREE.TextureLoader().load("resources/grass-2d.png");
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const material = new THREE.MeshPhongMaterial({
        map: texture,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
    });
    return { bufferGeometry, material };
}

async function getGrass3D(gltfLoader: THREE.GLTFLoader): Promise<ClutterDefinition> {
    const glb = await gltfLoader.loadAsync('resources/grass-3d.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff });
    return { bufferGeometry, material };
}

enum EGrassMode {
    GRASS_2D = "2d",
    GRASS_3D = "3d",
};

class TestGrass extends TestBase {
    private readonly gui: GUI;

    private readonly grass2D: GrassPatchesBatch;
    private readonly grass3D: GrassPatchesBatch;
    private readonly grassParticles: ReadonlyArray<GrassParticle>;

    private readonly fakeCamera: THREE.Object3D;

    private readonly parameters = {
        viewRadius: 20,
        transitionTime: 0.25,
        centerOnPlayer: true,
        grassMode: EGrassMode.GRASS_2D,
    };

    public static async instanciate(): Promise<TestGrass> {
        const gltfLoader = new THREE.GLTFLoader();
        const [grass2D, grass3D] = await Promise.all([
            getGrass2D(gltfLoader),
            getGrass3D(gltfLoader),
        ]);

        return new TestGrass(grass2D, grass3D);
    }

    private constructor(grass2D: ClutterDefinition, grass3D: ClutterDefinition) {
        super();

        this.camera.position.set(5, 5, 5);
        this.cameraControl.target.set(0, 1, 0);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 80);
        this.scene.add(dirLight);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        const grassContainer = new THREE.Object3D();
        this.scene.add(grassContainer);
        const count = 10000;
        this.grass2D = new GrassPatchesBatch({
            count,
            bufferGeometry: grass2D.bufferGeometry,
            material: grass2D.material,
        });
        grassContainer.add(this.grass2D.object3D);
        this.grass3D = new GrassPatchesBatch({
            count,
            bufferGeometry: grass3D.bufferGeometry,
            material: grass3D.material,
        });
        grassContainer.add(this.grass3D.object3D);

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
        this.grassParticles = particles;

        this.grassParticles.forEach((particle: GrassParticle, index: number) => {
            const matrix = new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeTranslation(new THREE.Vector3(particle.position.x, 0, particle.position.y)),
                new THREE.Matrix4().makeRotationY(Math.PI / 2 * Math.random()),//Math.floor(4 * Math.random())),
            );
            this.grass2D.setMatrix(index, matrix);
            this.grass3D.setMatrix(index, matrix);
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

        const applyGrassMode = () => {
            this.grass2D.object3D.visible = this.parameters.grassMode === EGrassMode.GRASS_2D;
            this.grass3D.object3D.visible = this.parameters.grassMode === EGrassMode.GRASS_3D;
        };
        applyGrassMode();

        this.gui = new GUI();
        this.gui.show();
        this.gui.add(this.grass2D, 'minDissolve', 0, 1, 0.01).name('Min dissolve');
        this.gui.add(this.parameters, 'transitionTime', 0, 2, 0.01).name('Transition time');
        this.gui.add(this.parameters, 'viewRadius', 0, 200, 1).name('View distance');
        this.gui.add(this.parameters, 'centerOnPlayer').name('Center view on player');
        this.gui.add(fakePlayer, 'visible').name('Show player');
        this.gui.add(ground, 'visible').name('Show ground');
        this.gui.add(grassContainer, 'visible').name('Show grass');
        this.gui.add(this.parameters, "grassMode", Object.values(EGrassMode)).name("Grass type").onChange(applyGrassMode);
    }

    protected override update(): void {
        this.fakeCamera.getWorldPosition(this.grass2D.playerWorldPosition);
        this.fakeCamera.getWorldPosition(this.grass3D.playerWorldPosition);
        this.grass2D.update();
        this.grass3D.update();

        const camera = this.parameters.centerOnPlayer ? this.fakeCamera : this.camera;
        const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
        cameraPosition.setY(0);

        const particlePosition = new THREE.Vector3();
        this.grassParticles.forEach((particle: GrassParticle, index: number) => {
            particlePosition.set(particle.position.x, 0, particle.position.y);

            const shouldBeVisible = cameraPosition.distanceTo(particlePosition) < this.parameters.viewRadius;
            if (particle.visible !== shouldBeVisible) {
                particle.visible = shouldBeVisible;
                particle.lastChangeTimestamp = performance.now();
            }

            const particleDissolveRatio = this.getParticleDissolveRatio(particle);
            this.grass2D.setDissolve(index, particleDissolveRatio);
            this.grass3D.setDissolve(index, particleDissolveRatio);
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

