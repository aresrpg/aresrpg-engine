import * as THREE from 'three';
import { OrbitControls, TransformControls } from 'three/examples/jsm/Addons.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { type TerrainBase } from '../lib/terrain/terrain-base';

import { type VoxelMap } from './voxel-map';

abstract class TestSetup {
    protected abstract readonly terrain: TerrainBase;

    private readonly stats: Stats;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly cameraControl: OrbitControls;
    protected readonly scene: THREE.Scene;

    public constructor(voxelMap: VoxelMap) {
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

        const playerContainer = new THREE.Group();
        playerContainer.position.x = 0;
        playerContainer.position.y = voxelMap.size.y + 1;
        playerContainer.position.z = 0;
        const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
        playerContainer.add(player);
        this.scene.add(playerContainer);

        const showWholeMap = false;
        if (showWholeMap) {
            const size = 1000;
            this.showMapPortion(new THREE.Box3(new THREE.Vector3(-size, -size, -size), new THREE.Vector3(size, size, size)));
        } else {
            const playerViewRadius = 1000;
            const playerViewSphere = new THREE.Mesh(
                new THREE.SphereGeometry(playerViewRadius, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
            );
            playerContainer.add(playerViewSphere);
            const playerControls = new TransformControls(this.camera, this.renderer.domElement);
            playerControls.addEventListener('dragging-changed', event => {
                this.cameraControl.enabled = !event.value;
            });
            playerControls.attach(playerContainer);
            this.scene.add(playerControls);

            const testFakeCamera = true;
            let fakeCameraRig: { container: THREE.Group; camera: THREE.PerspectiveCamera; helper: THREE.CameraHelper } | null = null;
            if (testFakeCamera) {
                const fakeCameraContainer = new THREE.Group();
                const fakeCamera = new THREE.PerspectiveCamera(60, 1, 1, 2000);
                const fakeCameraHelper = new THREE.CameraHelper(fakeCamera);
                fakeCameraContainer.add(fakeCamera);
                fakeCameraContainer.add(fakeCameraHelper);
                this.scene.add(fakeCameraContainer);
                fakeCameraRig = {
                    container: fakeCameraContainer,
                    camera: fakeCamera,
                    helper: fakeCameraHelper,
                };
            }
            setInterval(() => {
                let frustum: THREE.Frustum | undefined;

                if (fakeCameraRig) {
                    fakeCameraRig.container.position.set(0, 0, 0);
                    fakeCameraRig.container.lookAt(
                        new THREE.Vector3(10, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.0001 * performance.now())
                    );
                    fakeCameraRig.camera.updateMatrix();
                    fakeCameraRig.camera.updateMatrixWorld();
                    fakeCameraRig.camera.updateProjectionMatrix();
                    fakeCameraRig.helper?.update();

                    frustum = new THREE.Frustum();
                    frustum.setFromProjectionMatrix(
                        new THREE.Matrix4().multiplyMatrices(fakeCameraRig.camera.projectionMatrix, fakeCameraRig.camera.matrixWorldInverse)
                    );
                }

                this.showMapAroundPosition(playerContainer.position, playerViewRadius, frustum);
            }, 200);
        }

        setInterval(() => {
            this.terrain.setLod(this.camera.position, 100, 8000);
        }, 200);

        this.start();
    }

    protected abstract showMapPortion(box: THREE.Box3): void;
    protected abstract showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): Promise<void>;

    private start(): void {
        const render = () => {
            this.stats.update();

            this.cameraControl.update();
            this.terrain.update();
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
}

export { TestSetup };
