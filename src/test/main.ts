import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { EVerbosity, Terrain, setVerbosity } from '../lib/index';

import { VoxelMap } from './voxel-map';

setVerbosity(EVerbosity.DIAGNOSTIC);

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

camera.position.set(-50, 100, -50);
const cameraControl = new OrbitControls(camera, renderer.domElement);
cameraControl.target.set(voxelMap.size.x / 2, 0, voxelMap.size.z / 2);

const playerViewRadius = 32;
const playerContainer = new THREE.Group();
playerContainer.position.x = voxelMap.size.x / 2;
playerContainer.position.y = voxelMap.size.y + 1;
playerContainer.position.z = voxelMap.size.z / 2;
const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
const playerViewSphere = new THREE.Mesh(
    new THREE.SphereGeometry(playerViewRadius, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
);
playerContainer.add(player);
playerContainer.add(playerViewSphere);
const playerControls = new TransformControls(camera, renderer.domElement);
playerControls.addEventListener('dragging-changed', event => {
    cameraControl.enabled = !event.value;
});
playerControls.attach(playerContainer);
scene.add(playerContainer);
scene.add(playerControls);
setInterval(() => {
    terrain.showMapAroundPosition(playerContainer.position, playerViewRadius);
}, 200);

// terrain.showEntireMap();
function render(): void {
    stats.update();

    cameraControl.update();
    terrain.updateUniforms();
    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
}
window.requestAnimationFrame(render);
