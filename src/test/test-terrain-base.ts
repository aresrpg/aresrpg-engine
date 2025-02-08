import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import { MaterialsStore, type IHeightmap, type IVoxelMap, type TerrainViewer } from '../lib';

import { type HeightmapSample } from './map/voxel-map';
import { TestBase } from './test-base';

interface ITerrainMap {
    sampleHeightmapBaseTerrain(x: number, z: number): HeightmapSample;
}

abstract class TestTerrainBase extends TestBase {
    protected abstract readonly terrainViewer: TerrainViewer;

    protected readonly enableShadows: boolean = true;

    private readonly playerVisibility: null | {
        readonly fakeCamera: THREE.PerspectiveCamera;
        readonly fakeCameraHelper: THREE.CameraHelper;
        readonly visibilityFrustum: THREE.Frustum;
    } = null;

    protected readonly gui = new GUI();

    protected readonly voxelMaterialsStore: MaterialsStore;

    public constructor(voxelMap: IHeightmap & IVoxelMap & ITerrainMap) {
        super();

        this.voxelMaterialsStore = new MaterialsStore({
            voxelMaterialsList: voxelMap.voxelMaterialsList,
            maxShininess: 400,
        });

        this.setupLighting();

        const showWholeMap = false;
        if (showWholeMap) {
            const size = 300;
            setTimeout(() => {
                this.showMapPortion(
                    new THREE.Box3(
                        new THREE.Vector3(-size, voxelMap.altitude.min - 1, -size),
                        new THREE.Vector3(size, voxelMap.altitude.max, size)
                    )
                );
            }, 0);
        } else {
            const viewParams = {
                playerViewRadius: 10,
            };

            const playerContainer = new THREE.Group();
            playerContainer.name = 'player-container';
            playerContainer.position.x = 0;
            playerContainer.position.y = voxelMap.altitude.max + 1;
            playerContainer.position.z = 0;
            // const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
            // playerContainer.add(player);
            this.scene.add(playerContainer);

            // const playerViewSphere = new THREE.Mesh(
            //     new THREE.SphereGeometry(playerViewRadius, 16, 16),
            //     new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
            // );
            // playerContainer.add(playerViewSphere);
            const playerControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
            playerControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            playerControls.attach(playerContainer);
            this.scene.add(playerControls.getHelper());

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

                this.playerVisibility = {
                    fakeCamera,
                    fakeCameraHelper,
                    visibilityFrustum: new THREE.Frustum(),
                };
            }

            setInterval(() => {
                this.showMapAroundPosition(
                    playerContainer.position,
                    viewParams.playerViewRadius,
                    this.playerVisibility?.visibilityFrustum ?? undefined
                );
            }, 200);

            this.gui.add(viewParams, 'playerViewRadius', 1, 1000, 1);
        }

        setInterval(() => {
            this.terrainViewer.setLod(this.camera.position, 100, 3000);
        }, 200);
    }

    protected abstract showMapPortion(box: THREE.Box3): void;
    protected abstract showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void;

    protected override update(): void {
        if (this.playerVisibility) {
            const { fakeCamera, fakeCameraHelper, visibilityFrustum } = this.playerVisibility;

            fakeCamera.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.0003 * performance.now());
            fakeCamera.updateMatrix();
            fakeCamera.updateMatrixWorld(true);
            fakeCamera.updateProjectionMatrix();
            fakeCameraHelper.update();
            fakeCameraHelper.updateMatrixWorld(true);

            // playerVisibilityFrustum = new THREE.Frustum();
            visibilityFrustum.setFromProjectionMatrix(
                new THREE.Matrix4().multiplyMatrices(fakeCamera.projectionMatrix, fakeCamera.matrixWorldInverse)
            );
        }

        this.terrainViewer.update(this.renderer);
    }

    private setupLighting(): void {
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.name = 'dirlight';
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 100);
        this.scene.add(dirLight);
        this.gui.add(dirLight, 'intensity', 0, 3).name('Directional light');

        const ambientLight = new THREE.AmbientLight(0xffffff);
        ambientLight.name = 'ambient-light';
        this.scene.add(ambientLight);
        this.gui.add(ambientLight, 'intensity', 0, 3).name('Ambient light');

        if (this.enableShadows) {
            const planeReceivingShadows = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshPhongMaterial());
            planeReceivingShadows.name = 'shadows-plane';
            planeReceivingShadows.position.set(0, -20, 0);
            planeReceivingShadows.rotateOnAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
            planeReceivingShadows.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 4);
            planeReceivingShadows.receiveShadow = true;
            this.scene.add(planeReceivingShadows);
            const planeControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
            planeControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            planeControls.attach(planeReceivingShadows);
            this.scene.add(planeControls.getHelper());

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
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        const lightColor = new THREE.Color(0xffffff);
        ambientLight.color = lightColor;
        ambientLight.intensity = 1;

        dirLight.color = lightColor;
        dirLight.intensity = 3;
    }
}

export { TestTerrainBase, type ITerrainMap };
