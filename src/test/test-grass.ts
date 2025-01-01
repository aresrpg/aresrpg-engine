import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { GrassPatchesBatch } from '../lib';

import { RepeatableBluenoise } from './map/repeatable-bluenoise';
import { TestBase } from './test-base';

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
        alphaTest: 0.95,
    });
    return { bufferGeometry, material };
}

async function getGrass3D(gltfLoader: THREE.GLTFLoader): Promise<ClutterDefinition> {
    const glb = await gltfLoader.loadAsync('resources/grass-3d.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff });
    return { bufferGeometry, material };
}

async function getRocks(gltfLoader: THREE.GLTFLoader): Promise<ClutterDefinition> {
    const glb = await gltfLoader.loadAsync('resources/props-rocks.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);
    const material = new THREE.MeshPhongMaterial({ color: 0xdddddd });
    return { bufferGeometry, material };
}

enum EGrassMode {
    GRASS_2D = "2d",
    GRASS_3D = "3d",
};

type PositionsList = { position: THREE.Vector2Like }[];
interface IRepartition {
    getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): PositionsList;
}

type Parameters = {
    readonly propDefinitions: {
        readonly grass2D: ClutterDefinition;
        readonly grass3D: ClutterDefinition;
        readonly rocks: ClutterDefinition;
    };
    readonly repartitions: {
        readonly bluenoise: IRepartition;
        readonly whitenoise: IRepartition;
    };
};

class TestGrass extends TestBase {
    private readonly gui: GUI;

    private readonly grass2D: GrassPatchesBatch;
    private readonly grass3D: GrassPatchesBatch;
    private readonly rocks: GrassPatchesBatch;

    private readonly fakeCamera: THREE.Object3D;

    private readonly parameters = {
        viewRadius: 20,
        viewRadiusMargin: 2,
        grassMode: EGrassMode.GRASS_2D,
    };

    public static async instanciate(): Promise<TestGrass> {
        const gltfLoader = new THREE.GLTFLoader();
        const [grass2D, grass3D, rocks] = await Promise.all([
            getGrass2D(gltfLoader),
            getGrass3D(gltfLoader),
            getRocks(gltfLoader),
        ]);

        const whitenoiseDensity = 0.5;
        const whitenoiseRepartition: IRepartition = {
            getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): PositionsList {
                const result: PositionsList = [];
                const areaSize = new THREE.Vector2().subVectors(to, from);
                const totalArea = areaSize.x * areaSize.y;
                const totalItemsCount = totalArea * whitenoiseDensity;

                for (let i = 0; i < totalItemsCount; i++) {
                    result.push({
                        position: {
                            x: from.x + areaSize.x * Math.random(),
                            y: from.y + areaSize.y * Math.random(),
                        },
                    });
                }

                return result;
            },
        };

        const repeatableBluenoise = new RepeatableBluenoise("seed", 150, 2);
        const bluenoiseDensity = 2;
        const bluenoiseScaling = Math.ceil(bluenoiseDensity / 0.6);
        const bluenoiseRepartition: IRepartition = {
            getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): PositionsList {
                const rawItems = repeatableBluenoise.getAllItems(
                    new THREE.Vector2().addScaledVector(from, bluenoiseScaling),
                    new THREE.Vector2().addScaledVector(to, bluenoiseScaling),
                );
                return rawItems.map(item => {
                    return {
                        position: new THREE.Vector2().addScaledVector(item.position, 1 / bluenoiseScaling),
                    };
                });
            }
        }

        return new TestGrass({
            propDefinitions: { grass2D, grass3D, rocks },
            repartitions: {
                bluenoise: bluenoiseRepartition,
                whitenoise: whitenoiseRepartition,
            },
        });
    }

    private constructor(params: Parameters) {
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

        const allGrassParticlesPositions = params.repartitions.bluenoise.getAllItems({ x: -100, y: -100 }, { x: 100, y: 100 });
        console.log(`${allGrassParticlesPositions.length} grass items`);
        this.grass2D = new GrassPatchesBatch({
            count: allGrassParticlesPositions.length,
            bufferGeometry: params.propDefinitions.grass2D.bufferGeometry,
            material: params.propDefinitions.grass2D.material,
            reactToPlayer: true,
        });
        grassContainer.add(this.grass2D.object3D);
        this.grass3D = new GrassPatchesBatch({
            count: allGrassParticlesPositions.length,
            bufferGeometry: params.propDefinitions.grass3D.bufferGeometry,
            material: params.propDefinitions.grass3D.material,
            reactToPlayer: true,
        });
        grassContainer.add(this.grass3D.object3D);
        allGrassParticlesPositions.forEach((particle: { position: THREE.Vector2Like }, index: number) => {
            const matrix = new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeTranslation(new THREE.Vector3(particle.position.x, 0, particle.position.y)),
                new THREE.Matrix4().makeRotationY(Math.PI / 2 * Math.random()),//Math.floor(4 * Math.random())),
            );
            this.grass2D.setMatrix(index, matrix);
            this.grass3D.setMatrix(index, matrix);
        });

        const allRockParticlesPositions = params.repartitions.whitenoise.getAllItems({ x: -100, y: -100 }, { x: 100, y: 100 });
        console.log(`${allRockParticlesPositions.length} rock items`);
        this.rocks = new GrassPatchesBatch({
            count: allRockParticlesPositions.length,
            bufferGeometry: params.propDefinitions.rocks.bufferGeometry,
            material: params.propDefinitions.rocks.material,
            reactToPlayer: false,
        });
        grassContainer.add(this.rocks.object3D);
        allRockParticlesPositions.forEach((particle: { position: THREE.Vector2Like }, index: number) => {
            const matrix = new THREE.Matrix4().multiplyMatrices(
                new THREE.Matrix4().makeTranslation(new THREE.Vector3(particle.position.x, 0, particle.position.y)),
                new THREE.Matrix4().makeRotationY(Math.PI / 2 * Math.random()),
            );
            this.rocks.setMatrix(index, matrix);
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

        const applyViewDistance = () => {
            this.grass2D.setViewDistance(this.parameters.viewRadius);
            this.grass3D.setViewDistance(this.parameters.viewRadius);
            this.rocks.setViewDistance(this.parameters.viewRadius);
        };
        applyViewDistance();

        const applyViewDistanceMargin = () => {
            this.grass2D.setViewDistanceMargin(this.parameters.viewRadiusMargin);
            this.grass3D.setViewDistanceMargin(this.parameters.viewRadiusMargin);
            this.rocks.setViewDistanceMargin(this.parameters.viewRadiusMargin);
        };
        applyViewDistanceMargin();

        this.gui = new GUI();
        this.gui.show();
        this.gui.add(this.parameters, 'viewRadius', 0, 200, 1).name('View distance').onChange(applyViewDistance);
        this.gui.add(this.parameters, 'viewRadiusMargin', 0, 50, 0.1).name('View distance margin').onChange(applyViewDistanceMargin);
        this.gui.add(fakePlayer, 'visible').name('Show player');
        this.gui.add(ground, 'visible').name('Show ground');
        this.gui.add(grassContainer, 'visible').name('Show props');
        this.gui.add(this.parameters, "grassMode", Object.values(EGrassMode)).name("Grass type").onChange(applyGrassMode);
    }

    protected override update(): void {
        this.fakeCamera.getWorldPosition(this.grass2D.playerWorldPosition);
        this.fakeCamera.getWorldPosition(this.grass3D.playerWorldPosition);

        this.grass2D.update();
        this.grass3D.update();
        this.rocks.update();
    }
}

export { TestGrass };

