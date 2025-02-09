import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { PropsHandler, PropsViewer } from '../lib';

import { RepeatableBluenoise } from './map/repeatable-bluenoise';
import { TestBase } from './test-base';

type PropsDefinition = {
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

async function getGrass2D(gltfLoader: THREE.GLTFLoader): Promise<PropsDefinition> {
    const glb = await gltfLoader.loadAsync('resources/grass-2d.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);

    const texture = new THREE.TextureLoader().load('resources/grass-2d.png');
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const material = new THREE.MeshPhongMaterial({
        map: texture,
        side: THREE.DoubleSide,
        alphaTest: 0.95,
    });
    return { bufferGeometry, material };
}

async function getGrass3D(gltfLoader: THREE.GLTFLoader): Promise<PropsDefinition> {
    const glb = await gltfLoader.loadAsync('resources/grass-3d.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff });
    return { bufferGeometry, material };
}

async function getRocks(gltfLoader: THREE.GLTFLoader): Promise<PropsDefinition> {
    const glb = await gltfLoader.loadAsync('resources/props-rocks.glb');
    const bufferGeometry = extractBufferGeometry(glb.scene);
    const material = new THREE.MeshPhongMaterial({ color: 0xdddddd });
    return { bufferGeometry, material };
}

enum EGrassMode {
    GRASS_2D = '2d',
    GRASS_3D = '3d',
}

interface IRepartition {
    getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): THREE.Vector2Like[];
}

type Parameters = {
    readonly propDefinitions: {
        readonly grass2D: PropsDefinition;
        readonly grass3D: PropsDefinition;
        readonly rocks: PropsDefinition;
    };
    readonly repartitions: {
        readonly bluenoise: IRepartition;
        readonly whitenoise: IRepartition;
    };
};

class TestGrass extends TestBase {
    private readonly gui: GUI;

    private readonly grass2D: PropsViewer;
    private readonly grass3D: PropsViewer;
    private readonly rocks: PropsHandler;

    private readonly grassRepartition: IRepartition;
    private readonly rocksRepartition: IRepartition;

    private readonly fakePlayer: THREE.Object3D;

    private readonly patchSize = 64;

    private readonly parameters = {
        viewRadius: 20,
        viewRadiusMargin: 2,
        grassMode: EGrassMode.GRASS_2D,
    };

    public static async instanciate(): Promise<TestGrass> {
        const gltfLoader = new THREE.GLTFLoader();
        const [grass2D, grass3D, rocks] = await Promise.all([getGrass2D(gltfLoader), getGrass3D(gltfLoader), getRocks(gltfLoader)]);

        const whitenoiseDensity = 0.5;
        const whitenoiseRepartition: IRepartition = {
            getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): THREE.Vector2Like[] {
                const result: THREE.Vector2Like[] = [];
                const areaSize = new THREE.Vector2().subVectors(to, from);
                const totalArea = areaSize.x * areaSize.y;
                const totalItemsCount = totalArea * whitenoiseDensity;

                for (let i = 0; i < totalItemsCount; i++) {
                    result.push({
                        x: from.x + areaSize.x * Math.random(),
                        y: from.y + areaSize.y * Math.random(),
                    });
                }

                return result;
            },
        };

        const repeatableBluenoise = new RepeatableBluenoise('seed', 150, 2);
        const bluenoiseDensity = 2;
        const bluenoiseScaling = Math.ceil(bluenoiseDensity / 0.6);
        const bluenoiseRepartition: IRepartition = {
            getAllItems(from: THREE.Vector2Like, to: THREE.Vector2Like): THREE.Vector2Like[] {
                const rawItems = repeatableBluenoise.getAllItems(
                    new THREE.Vector2().addScaledVector(from, bluenoiseScaling),
                    new THREE.Vector2().addScaledVector(to, bluenoiseScaling)
                );
                return rawItems.map(item => new THREE.Vector2().addScaledVector(item.position, 1 / bluenoiseScaling));
            },
        };

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

        const propsContainer = new THREE.Object3D();
        propsContainer.name = 'props-container';
        this.scene.add(propsContainer);

        this.grassRepartition = params.repartitions.bluenoise;
        this.rocksRepartition = params.repartitions.whitenoise;

        this.grass2D = new PropsViewer({
            bufferGeometry: params.propDefinitions.grass2D.bufferGeometry,
            material: params.propDefinitions.grass2D.material,
            reactToPlayer: true,
            reactToWind: true,
            chunkSize: new THREE.Vector3(this.patchSize, this.patchSize, this.patchSize),
            garbageCollect: {
                interval: 5000,
                invisibleGroupsCacheSize: 5,
            },
        });
        propsContainer.add(this.grass2D.container);
        this.grass3D = new PropsViewer({
            bufferGeometry: params.propDefinitions.grass3D.bufferGeometry,
            material: params.propDefinitions.grass3D.material,
            reactToPlayer: true,
            chunkSize: new THREE.Vector3(this.patchSize, this.patchSize, this.patchSize),
        });
        propsContainer.add(this.grass3D.container);

        this.rocks = new PropsHandler({
            bufferGeometry: params.propDefinitions.rocks.bufferGeometry,
            material: params.propDefinitions.rocks.material,
            reactToPlayer: false,
        });
        propsContainer.add(this.rocks.container);

        this.fakePlayer = new THREE.Object3D();
        this.fakePlayer.name = 'fake-player';
        this.fakePlayer.position.set(0, 0.5, 0);
        const boardCenterControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        boardCenterControls.showY = false;
        boardCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        const fakePlayerMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 12, 12),
            new THREE.MeshPhongMaterial({ color: 0xffffff, wireframe: false })
        );
        fakePlayerMesh.name = 'fake-player-mesh';
        this.fakePlayer.add(fakePlayerMesh);
        boardCenterControls.attach(this.fakePlayer);
        this.scene.add(this.fakePlayer);
        this.scene.add(boardCenterControls.getHelper());

        const groundSize = 1000;
        const voxelsInGroundTexture = 20;
        const groundTextureSize = 5 * voxelsInGroundTexture;
        const groundTextureBuffer = new Uint8Array(groundTextureSize * groundTextureSize * 4);
        for (let i = 0; i < groundTextureSize * groundTextureSize; i++) {
            const rand = 255 * (Math.random() - 0.5) * 0.1;
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
        ground.name = 'ground';
        ground.rotateX(-Math.PI / 2);
        ground.scale.set(groundSize, groundSize, 1);
        this.scene.add(ground);

        setInterval(() => {
            const statistics = this.grass2D.getStatistics();
            const occupationPercentage = statistics.totalInstancesUsed / statistics.totalInstancesCapacity;
            console.log(`${(100 * occupationPercentage).toFixed(1)} % `, JSON.stringify(statistics));
        }, 1000);

        const applyGrassMode = () => {
            this.grass2D.container.visible = this.parameters.grassMode === EGrassMode.GRASS_2D;
            this.grass3D.container.visible = this.parameters.grassMode === EGrassMode.GRASS_3D;
        };
        applyGrassMode();

        const updateAllVisibilities = () => {
            const cameraWorldPosition = this.camera.getWorldPosition(new THREE.Vector3());
            this.grass2D.updateVisibilities(cameraWorldPosition);
            this.grass3D.updateVisibilities(cameraWorldPosition);
            this.rocks.updateVisibilities(cameraWorldPosition);
        };
        setInterval(updateAllVisibilities, 150);
        updateAllVisibilities();

        const applyViewDistance = () => {
            this.grass2D.setViewDistance(this.parameters.viewRadius);
            this.grass3D.setViewDistance(this.parameters.viewRadius);
            this.rocks.setViewDistance(this.parameters.viewRadius);
            updateAllVisibilities();
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
        this.gui.add(this.parameters, 'viewRadius', 0, 1000, 1).name('View distance').onChange(applyViewDistance);
        this.gui.add(this.parameters, 'viewRadiusMargin', 0, 50, 0.1).name('View distance margin').onChange(applyViewDistanceMargin);
        this.gui.add(fakePlayerMesh, 'visible').name('Show player');
        this.gui.add(ground, 'visible').name('Show ground');
        this.gui.add(propsContainer, 'visible').name('Show props');
        this.gui.add(this.rocks.container, 'visible').name('Show rocks');
        this.gui.add(this.parameters, 'grassMode', Object.values(EGrassMode)).name('Grass type').onChange(applyGrassMode);
    }

    protected override update(deltaMilliseconds: number): void {
        const cameraWorldPosition3d = this.camera.getWorldPosition(new THREE.Vector3());
        const cameraWorldFloorPosition = new THREE.Vector3(cameraWorldPosition3d.x, 0, cameraWorldPosition3d.z);

        const fromPatch = cameraWorldFloorPosition.clone().subScalar(this.parameters.viewRadius).divideScalar(this.patchSize).floor();
        const toPatch = cameraWorldFloorPosition.clone().addScalar(this.parameters.viewRadius).divideScalar(this.patchSize).floor();

        const patchId = new THREE.Vector3();
        for (patchId.x = fromPatch.x; patchId.x <= toPatch.x; patchId.x++) {
            for (patchId.z = fromPatch.z; patchId.z <= toPatch.z; patchId.z++) {
                const patchStart = patchId.clone().multiplyScalar(this.patchSize);
                const patchEnd = patchStart.clone().addScalar(this.patchSize);

                if ((patchId.x + patchId.z) % 2 === 0 && !this.grass2D.hasChunkProps(patchId)) {
                    const grassParticlesPositions = this.grassRepartition.getAllItems(
                        { x: patchStart.x, y: patchStart.z },
                        { x: patchEnd.x, y: patchEnd.z }
                    );
                    const grassParticlesMatricesWorld = grassParticlesPositions.map(position =>
                        new THREE.Matrix4().multiplyMatrices(
                            new THREE.Matrix4().makeTranslation(position.x, 0, position.y),
                            new THREE.Matrix4().makeRotationY((Math.PI / 2) * Math.random()) // Math.floor(4 * Math.random())),
                        )
                    );
                    this.grass2D.setChunkPropsFromWorldMatrices(patchId, grassParticlesMatricesWorld);

                    const worldToLocal = new THREE.Matrix4().makeTranslation(-patchStart.x, -patchStart.y, -patchStart.z);
                    const grassParticlesMatricesLocal = grassParticlesMatricesWorld.map(matrixWorld =>
                        new THREE.Matrix4().multiplyMatrices(worldToLocal, matrixWorld)
                    );
                    this.grass3D.setChunkPropsFromLocalMatrices(patchId, grassParticlesMatricesLocal);
                }

                const patchIdString = `${patchId.x}_${patchId.y}_${patchId.z}`;
                if (!this.rocks.hasGroup(patchIdString)) {
                    const rockParticlesPositions = this.rocksRepartition.getAllItems(
                        { x: patchStart.x, y: patchStart.z },
                        { x: patchEnd.x, y: patchEnd.z }
                    );
                    const rockParticlesMatrices = rockParticlesPositions.map(position =>
                        new THREE.Matrix4().multiplyMatrices(
                            new THREE.Matrix4().makeTranslation(new THREE.Vector3(position.x, 0, position.y)),
                            new THREE.Matrix4().makeRotationY((Math.PI / 2) * Math.random())
                        )
                    );
                    this.rocks.setGroup(patchIdString, rockParticlesMatrices);
                }
            }
        }

        const playerViewPosition = this.fakePlayer.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.camera.matrixWorldInverse);

        this.grass2D.setPlayerViewPosition(playerViewPosition);
        this.grass3D.setPlayerViewPosition(playerViewPosition);

        this.grass2D.update(deltaMilliseconds);
    }
}

export { TestGrass };
