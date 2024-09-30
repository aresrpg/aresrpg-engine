import * as THREE from 'three-usage-test';

import { type IHeightmap, type IHeightmapSample, type IVoxelMap, type TerrainViewer } from '../lib';

import { TestBase } from './test-base';

interface ITerrainMap {
    sampleHeightmapBaseTerrain(x: number, z: number): IHeightmapSample;
}

abstract class TestTerrainBase extends TestBase {
    protected abstract readonly terrainViewer: TerrainViewer;

    protected readonly enableShadows: boolean = true;

    private readonly playerVisibility: null | {
        readonly fakeCamera: THREE.PerspectiveCamera;
        readonly fakeCameraHelper: THREE.CameraHelper;
        readonly visibilityFrustum: THREE.Frustum;
    } = null;

    public constructor(voxelMap: IHeightmap & IVoxelMap & ITerrainMap) {
        super();

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
            const playerViewRadius = 10;

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
            const playerControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
            playerControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            playerControls.attach(playerContainer);
            this.scene.add(playerControls);

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
                    playerViewRadius,
                    this.playerVisibility?.visibilityFrustum ?? undefined
                );
            }, 200);
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

        this.terrainViewer.update();
    }

    private setupLighting(): void {
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 100);
        this.scene.add(dirLight);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        if (this.enableShadows) {
            const planeReceivingShadows = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshPhongMaterial());
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
}

export { TestTerrainBase, type ITerrainMap };