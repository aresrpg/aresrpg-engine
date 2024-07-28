import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { type IHeightmap, type IHeightmapSample, type TerrainViewer, type IVoxelMap, type VoxelsChunkData } from '../lib';
import { type VoxelsRenderable } from '../lib/terrain/voxelmap/voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpuWorker } from '../lib/terrain/voxelmap/voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';

import { computePlateau, EPlateauSquareType } from './plateau/plateau';

interface ITerrainMap {
    sampleHeightmapBaseTerrain(x: number, z: number): IHeightmapSample;
}

abstract class TestBase {
    protected abstract readonly terrainViewer: TerrainViewer;

    private readonly stats: Stats;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly cameraControl: OrbitControls;
    protected readonly scene: THREE.Scene;

    private started: boolean = false;

    private update: VoidFunction = () => { };

    public constructor(voxelMap: IHeightmap & IVoxelMap & ITerrainMap) {
        this.stats = new Stats();
        document.body.appendChild(this.stats.dom);

        this.renderer = new THREE.WebGLRenderer();
        document.body.appendChild(this.renderer.domElement);
        this.renderer.setClearColor(0x880000);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        const udpateRendererSize = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.renderer.setSize(width, height);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', udpateRendererSize);
        udpateRendererSize();

        this.camera.position.set(-200, 400, 200);
        this.cameraControl = new OrbitControls(this.camera, this.renderer.domElement);
        this.cameraControl.target.set(0, 0, 0);

        this.scene = new THREE.Scene();
        this.scene.name = 'Scene';
        this.scene.matrixAutoUpdate = false;
        this.scene.add(new THREE.AxesHelper(500));

        this.setupLighting();

        const showWholeMap = false;
        if (showWholeMap) {
            const size = 300;
            setTimeout(() => {
                this.showMapPortion(
                    new THREE.Box3(
                        new THREE.Vector3(-size, voxelMap.minAltitude - 1, -size),
                        new THREE.Vector3(size, voxelMap.maxAltitude, size)
                    )
                );
            }, 0);
        } else {
            const playerViewRadius = 500;

            const playerContainer = new THREE.Group();
            playerContainer.position.x = 0;
            playerContainer.position.y = voxelMap.maxAltitude + 1;
            playerContainer.position.z = 0;
            // const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
            // playerContainer.add(player);
            this.scene.add(playerContainer);

            // const playerViewSphere = new THREE.Mesh(
            //     new THREE.SphereGeometry(playerViewRadius, 16, 16),
            //     new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
            // );
            // playerContainer.add(playerViewSphere);
            const playerControls = new TransformControls(this.camera, this.renderer.domElement);
            playerControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            playerControls.attach(playerContainer);
            // this.scene.add(playerControls);

            let playerVisibilityFrustum: THREE.Frustum | undefined;

            const testPlayerVisilibityFrustum = true;
            if (testPlayerVisilibityFrustum) {
                const fakeCamera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
                const fakeCameraHelper = new THREE.CameraHelper(fakeCamera);
                fakeCameraHelper.setColors(
                    new THREE.Color(0xff0000),
                    new THREE.Color(0xff0000),
                    new THREE.Color(0x0000ff),
                    new THREE.Color(0x00ff00),
                    new THREE.Color(0x00ff00)
                );
                // this.scene.add(fakeCameraHelper);
                playerContainer.add(fakeCamera);

                this.update = () => {
                    fakeCamera.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.0003 * performance.now());
                    fakeCamera.updateMatrix();
                    fakeCamera.updateMatrixWorld(true);
                    fakeCamera.updateProjectionMatrix();
                    fakeCameraHelper.update();
                    fakeCameraHelper.updateMatrixWorld(true);

                    playerVisibilityFrustum = new THREE.Frustum();
                    playerVisibilityFrustum.setFromProjectionMatrix(
                        new THREE.Matrix4().multiplyMatrices(fakeCamera.projectionMatrix, fakeCamera.matrixWorldInverse)
                    );
                };
            }

            setInterval(() => {
                this.showMapAroundPosition(playerContainer.position, playerViewRadius, playerVisibilityFrustum);
            }, 200);
        }

        setInterval(() => {
            this.terrainViewer.setLod(this.camera.position, 100, 6000);
        }, 200);

        const testPlateau = true;
        if (testPlateau) {
            this.setupPlateau(voxelMap);
        }
    }

    protected abstract showMapPortion(box: THREE.Box3): void;
    protected abstract showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void;

    public start(): void {
        if (this.started) {
            console.warn('Cannot start a TestBase twice');
            return;
        }
        this.started = true;

        const render = () => {
            this.stats.update();

            this.update();
            this.cameraControl.update();
            this.terrainViewer.update();
            this.renderer.render(this.scene, this.camera);
            window.requestAnimationFrame(render);
        };
        window.requestAnimationFrame(render);
    }

    private setupLighting(): void {
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 100);
        this.scene.add(dirLight);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        const testShadows = false;
        if (testShadows) {
            const planeReceivingShadows = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshPhongMaterial());
            planeReceivingShadows.position.set(0, -20, 0);
            planeReceivingShadows.rotateOnAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
            planeReceivingShadows.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 4);
            planeReceivingShadows.receiveShadow = true;
            this.scene.add(planeReceivingShadows);
            const planeControls = new TransformControls(this.camera, this.renderer.domElement);
            planeControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            planeControls.attach(planeReceivingShadows);
            this.scene.add(planeControls);

            // const sphereCastingShadows = new THREE.Mesh(new THREE.SphereGeometry(10), new THREE.MeshPhongMaterial());
            // sphereCastingShadows.position.set(20, 30, 20);
            // sphereCastingShadows.castShadow = true;
            // scene.add(sphereCastingShadows);

            dirLight.castShadow = true;
            dirLight.shadow.camera.top = 200;
            dirLight.shadow.camera.bottom = -200;
            dirLight.shadow.camera.left = -200;
            dirLight.shadow.camera.right = 200;

            dirLight.shadow.mapSize.width = 1024;
            dirLight.shadow.mapSize.height = 1024;

            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
        }

        const lightColor = new THREE.Color(0xffffff);
        ambientLight.color = lightColor;
        ambientLight.intensity = 1;

        dirLight.color = lightColor;
        dirLight.intensity = 3;
    }

    private setupPlateau(voxelMap: IVoxelMap & ITerrainMap): void {
        const maxPlateauSize = 128;
        const factory = new VoxelsRenderableFactoryCpuWorker(voxelMap.voxelMaterialsList, { xz: maxPlateauSize, y: 16 }, 1);

        const plateauContainer = new THREE.Group();
        this.scene.add(plateauContainer);
        let plateauRenderable: VoxelsRenderable | null = null;

        let lastPlateauRequestId = -1;
        const requestPlateau = async (origin: THREE.Vector3Like) => {
            lastPlateauRequestId++;
            const requestId = lastPlateauRequestId;

            const plateau = await computePlateau(voxelMap, origin);
            const plateauThickness = 1;

            const chunkSize = new THREE.Vector3(plateau.size.x + 2, 1 + plateauThickness + 1 + 1, plateau.size.y + 2);
            let chunkIsEmpty = true;
            const chunkData = new Uint16Array(chunkSize.x * chunkSize.y * chunkSize.z);
            for (let iChunkZ = 0; iChunkZ < chunkSize.z; iChunkZ++) {
                for (let iChunkX = 0; iChunkX < chunkSize.x; iChunkX++) {
                    const plateauX = iChunkX - 1;
                    const plateauZ = iChunkZ - 1;
                    if (plateauX < 0 || plateauZ < 0 || plateauX >= plateau.size.x || plateauZ >= plateau.size.y) {
                        continue;
                    }

                    const plateauSquare = plateau.squares[plateauX + plateauZ * plateau.size.x];
                    if (!plateauSquare) {
                        throw new Error();
                    }

                    const fromPlateauY = 0;
                    let toPlateauY = -1;
                    if (plateauSquare.type === EPlateauSquareType.FLAT) {
                        toPlateauY = plateauThickness;
                    } else if (plateauSquare.type === EPlateauSquareType.OBSTACLE) {
                        toPlateauY = plateauThickness + 1;
                    }
                    const fromChunkY = fromPlateauY + 1;
                    const toChunkY = toPlateauY + 1;

                    for (let iChunkY = fromChunkY; iChunkY < toChunkY; iChunkY++) {
                        const index = iChunkX + iChunkY * chunkSize.x + iChunkZ * (chunkSize.x * chunkSize.y);
                        chunkData[index] = plateauSquare.materialId + 1;
                        chunkIsEmpty = false;
                    }
                }
            }

            const chunk: VoxelsChunkData = {
                size: chunkSize,
                isEmpty: chunkIsEmpty,
                data: chunkData,
            };

            const renderable = await factory.buildVoxelsRenderable(chunk);

            if (lastPlateauRequestId !== requestId) {
                return; // another request was launched in the meantime
            }

            plateauContainer.clear();
            if (plateauRenderable) {
                plateauRenderable.dispose();
                plateauRenderable = null;
            }
            plateauRenderable = renderable;
            if (plateauRenderable) {
                plateauRenderable.container.position.set(plateau.origin.x, plateau.origin.y - plateauThickness, plateau.origin.z);
                plateauContainer.add(plateauRenderable.container);
            }
        };

        const plateauCenterContainer = new THREE.Group();
        const plateauCenter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }));
        plateauCenter.position.set(0.5, 0.5, 0.5);
        plateauCenterContainer.add(plateauCenter);

        const updateAltitude = () => {
            const terrainSample = voxelMap.sampleHeightmapBaseTerrain(
                Math.floor(plateauCenterContainer.position.x),
                Math.floor(plateauCenterContainer.position.z)
            );
            plateauCenterContainer.position.setY(terrainSample.altitude + 1);
            requestPlateau(plateauCenterContainer.position.clone());
        };
        updateAltitude();

        const plateauCenterControls = new TransformControls(this.camera, this.renderer.domElement);
        plateauCenterControls.showY = false;
        plateauCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        plateauCenterControls.addEventListener('change', updateAltitude);
        plateauCenterControls.attach(plateauCenterContainer);

        this.scene.add(plateauCenterContainer);
        this.scene.add(plateauCenterControls);
    }
}

export { TestBase, type ITerrainMap };
