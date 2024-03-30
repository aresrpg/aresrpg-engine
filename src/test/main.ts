import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { ELogLevel, Terrain, setVerbosity } from '../lib/index';

import { VoxelMap } from './voxel-map';

setVerbosity(ELogLevel.DIAGNOSTIC);

const stats = new Stats();
document.body.appendChild(stats.dom);

const renderer = new THREE.WebGLRenderer();
document.body.appendChild(renderer.domElement);
renderer.setClearColor(0x880000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const udpateRendererSize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
};
window.addEventListener('resize', udpateRendererSize);
udpateRendererSize();

const scene = new THREE.Scene();

const voxelMap = new VoxelMap(512, 512, 16);
const terrain = new Terrain(voxelMap);
scene.add(terrain.container);

scene.add(new THREE.AxesHelper(500));

camera.position.set(-50, 100, 50);
const cameraControl = new OrbitControls(camera, renderer.domElement);
cameraControl.target.set(voxelMap.size.x / 2, 0, voxelMap.size.z / 2);

const playerViewRadius = 40;
const playerContainer = new THREE.Group();
playerContainer.position.x = voxelMap.size.x / 2;
playerContainer.position.y = voxelMap.size.y + 1;
playerContainer.position.z = voxelMap.size.z / 2;
const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
playerContainer.add(player);
scene.add(playerContainer);

const showWholeMap = true;
if (showWholeMap) {
    terrain.showEntireMap();
} else {
    const playerViewSphere = new THREE.Mesh(
        new THREE.SphereGeometry(playerViewRadius, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    );
    playerContainer.add(playerViewSphere);
    const playerControls = new TransformControls(camera, renderer.domElement);
    playerControls.addEventListener('dragging-changed', event => {
        cameraControl.enabled = !event.value;
    });
    playerControls.attach(playerContainer);
    scene.add(playerControls);

    setInterval(() => {
        terrain.showMapAroundPosition(playerContainer.position, playerViewRadius);
    }, 200);
}

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
const ambientLight = new THREE.AmbientLight(0xffffff);

const testShadows = true;
if (testShadows) {
    const planeReceivingShadows = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshPhongMaterial());
    planeReceivingShadows.position.set(0, -20, 0);
    planeReceivingShadows.rotateOnAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
    planeReceivingShadows.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    planeReceivingShadows.receiveShadow = true;
    scene.add(planeReceivingShadows);
    const planeControls = new TransformControls(camera, renderer.domElement);
    planeControls.addEventListener('dragging-changed', event => {
        cameraControl.enabled = !event.value;
    });
    planeControls.attach(planeReceivingShadows);
    scene.add(planeControls);

    // const sphereCastingShadows = new THREE.Mesh(new THREE.SphereGeometry(10), new THREE.MeshPhongMaterial());
    // sphereCastingShadows.position.set(20, 30, 20);
    // sphereCastingShadows.castShadow = true;
    // scene.add(sphereCastingShadows);

    dirLight.target.position.set(0, 0, 0);
    dirLight.position.set(100, 50, 100);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 200;
    dirLight.shadow.camera.bottom = -200;
    dirLight.shadow.camera.left = -200;
    dirLight.shadow.camera.right = 200;

    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
}

scene.add(ambientLight);

ambientLight.color = terrain.parameters.lighting.color;
ambientLight.intensity = 0.3;

dirLight.color = terrain.parameters.lighting.color;
dirLight.intensity = 1.5;

function render(): void {
    stats.update();

    cameraControl.update();
    terrain.updateUniforms();
    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
}
window.requestAnimationFrame(render);
