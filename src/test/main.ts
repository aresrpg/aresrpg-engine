
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AresRpgEngine } from "../lib/index";
import { VoxelMap } from "./voxel-map";

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
window.addEventListener("resize", udpateRendererSize);
udpateRendererSize();

const scene = new THREE.Scene();

const voxelMap = new VoxelMap(256, 256, 16);
const terrain = new AresRpgEngine.Terrain(voxelMap);
scene.add(terrain.container);

const boundingBox = new THREE.Mesh(
    new THREE.BoxGeometry(voxelMap.size.x, voxelMap.size.y, voxelMap.size.z),
    new THREE.MeshBasicMaterial({
        color: "#FFFFFF",
        wireframe: true,
    }));
boundingBox.position.set(voxelMap.size.x / 2, voxelMap.size.y / 2, voxelMap.size.z / 2);
scene.add(boundingBox);

scene.add(new THREE.AxesHelper(500));

camera.position.set(-50, 100, -50);
const cameraControl = new OrbitControls(camera, renderer.domElement);
cameraControl.target.set(voxelMap.size.x / 2, 0, voxelMap.size.z / 2);

terrain.showEntireMap();
function render(): void {
    cameraControl.update();
    terrain.updateUniforms();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
}
requestAnimationFrame(render);
