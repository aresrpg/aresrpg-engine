import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

import { ELogLevel, Terrain, setVerbosity } from '../lib/index';

import { VoxelMap } from './voxel-map';
import { SkeletonUtils } from 'three/examples/jsm/Addons.js';
import { GUI } from "dat.gui";

setVerbosity(ELogLevel.DIAGNOSTIC);

const stats = new Stats();
document.body.appendChild(stats.dom);

const renderer = new THREE.WebGLRenderer();
document.body.appendChild(renderer.domElement);
renderer.setClearColor(0x880000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
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

const voxelMap = new VoxelMap(1024, 1024, 16, 'fixed_seed');
const terrain = new Terrain(voxelMap, {
    patchSize: { xz: 128, y: 64 },
});
scene.add(terrain.container);

scene.add(new THREE.AxesHelper(500));

camera.position.set(-30, 50, 30);
const cameraControl = new OrbitControls(camera, renderer.domElement);
cameraControl.target.set(0, 0, 0);

const playerViewRadius = 250;
const playerContainer = new THREE.Group();
playerContainer.position.x = 0;
playerContainer.position.y = voxelMap.size.y + 1;
playerContainer.position.z = 0;
const player = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({ color: '#FF0000' }));
playerContainer.add(player);
scene.add(playerContainer);

const showWholeMap = true;
if (showWholeMap) {
    const size = 250;
    terrain.showMapPortion(new THREE.Box3(new THREE.Vector3(-size, -size, -size), new THREE.Vector3(size, size, size)));
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
    planeReceivingShadows.position.set(0, -50, 0);
    planeReceivingShadows.rotateOnAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 4);
    planeReceivingShadows.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    planeReceivingShadows.receiveShadow = true;
    // scene.add(planeReceivingShadows);
    // const planeControls = new TransformControls(camera, renderer.domElement);
    // planeControls.addEventListener('dragging-changed', event => {
    //     cameraControl.enabled = !event.value;
    // });
    // planeControls.attach(planeReceivingShadows);
    // scene.add(planeControls);

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

const lightColor = new THREE.Color(0xffffff);
ambientLight.color = lightColor;
ambientLight.intensity = 1;

dirLight.color = lightColor;
dirLight.intensity = 3;

setInterval(() => {
    terrain.setLod(camera.position, 100, 8000);
}, 200);

type Character = {
    readonly model: THREE.Object3D;
    readonly mixer: THREE.AnimationMixer;
    lastAnimationTimestamp: number,
};
const characters: Character[] = [];

const gui = new GUI();

const params = {
    count: 100,
    enableAnimations: true,
    lod: {
        enabled: true,
        minPeriod: 15,
        maxPeriod: 120,
        maxDistance: 100,
    }
};

async function setupCharacters(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    gltfLoader.setDRACOLoader(dracoLoader)
    const gltf = await gltfLoader.loadAsync('resource/iop_male.glb');
    const model = gltf.scene;
    model.traverse(object => {
        if (object.type === "SkinnedMesh") {
            object.castShadow = true;
            object.receiveShadow = true;
        }
    });
    const animations = gltf.animations;

    const rowLength = 50;
    const spacing = 3;
    const setCharactersCount = (count: number) => {
        while (characters.length < count) {
            const characterId = characters.length;

            const modelClone = SkeletonUtils.clone(model);
            modelClone.castShadow = true;
            modelClone.receiveShadow = true;

            modelClone.position.set(
                spacing * ((characterId % rowLength) - 0.5 * rowLength),
                20,
                spacing * Math.floor(characterId / rowLength));
            const animationMixer = new THREE.AnimationMixer(modelClone);
            const animation = animations[Math.floor(Math.random() * animations.length)]!;
            const animationClip = animationMixer.clipAction(animation);
            setTimeout(() => animationClip.play(), Math.random() * 500);

            scene.add(modelClone);
            characters.push({
                model: modelClone,
                mixer: animationMixer,
                lastAnimationTimestamp: performance.now(),
            });
        }

        characters.forEach((character, index) => {
            const visible = (index < count);
            if (character.model.visible !== visible) {
                character.model.visible = visible;

                if (!character.model.visible) {
                    scene.remove(character.model);
                } else {
                    scene.add(character.model);
                }
            }
        });
    };

    setCharactersCount(params.count);

    gui.add(params, "count", 1, 1000, 1).onChange(value => setCharactersCount(value));
    gui.add(params, "enableAnimations");

    const lodFolder = gui.addFolder("Animations LOD");
    lodFolder.add(params.lod, "enabled").name("Enabled");
    lodFolder.add(params.lod, "maxPeriod", params.lod.minPeriod, 500);
    lodFolder.add(params.lod, "maxDistance", 10, 200);
    lodFolder.open();
}

setupCharacters();

function render(): void {
    stats.update();

    if (params.enableAnimations) {
        const now = performance.now();

        for (const character of characters) {
            if (character.model.visible) {
                const dt = now - character.lastAnimationTimestamp;

                let period = params.lod.minPeriod;

                if (params.lod.enabled) {
                    const distance = camera.position.distanceTo(character.model.position);
                    const lodLevel = Math.min(1, distance / params.lod.maxDistance);
                    period = params.lod.minPeriod + lodLevel * (params.lod.maxPeriod - params.lod.minPeriod);
                }

                if (dt >= period) {
                    character.mixer.update(dt / 1000);
                    character.lastAnimationTimestamp = now;
                }
            } else {
                character.lastAnimationTimestamp = now;
            }
        }
    }

    cameraControl.update();
    terrain.update();
    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
}
window.requestAnimationFrame(render);
