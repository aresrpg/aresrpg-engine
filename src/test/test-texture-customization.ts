import { GUI } from 'lil-gui';
import * as THREE from 'three-usage-test';

import { CustomizableTexture } from '../lib';

import { TestBase } from './test-base';

const models: string[] = [
    "iop_male",
];

type Character = {
    readonly scene: THREE.Object3D;
    readonly customizableTexture: CustomizableTexture;
};

class TestTextureCustomization extends TestBase {
    private readonly gui: GUI;

    private readonly parameters = {
        model: models[0]!,
        color1: 0xff0000,
        color2: 0x00ff00,
        color3: 0x0000ff,
    };

    private readonly container: THREE.Object3D;
    private readonly gltfLoader: THREE.GLTFLoader;
    private readonly dracoLoader: THREE.DRACOLoader;

    private readonly characters: Map<string, Character | Promise<Character>>;

    public constructor() {
        super();

        this.gltfLoader = new THREE.GLTFLoader();
        this.dracoLoader = new THREE.DRACOLoader();
        this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        this.dracoLoader.setDecoderConfig({ type: 'js' });
        this.gltfLoader.setDRACOLoader(this.dracoLoader);

        this.container = new THREE.Group();
        this.scene.add(this.container);

        this.characters = new Map();

        this.camera.position.set(1, 1.5, 2);
        this.cameraControl.target.set(0, 1, 0);

        const gridHelper = new THREE.GridHelper(1000, 100);
        gridHelper.position.setY(-0.01);
        this.scene.add(gridHelper);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        const enforceColors = () => {
            this.enforceColors();
        };
        this.gui = new GUI();
        this.gui.add(this.parameters, "model", models).onChange(() => this.enforceModel());
        this.gui.addColor(this.parameters, 'color1').onChange(enforceColors);
        this.gui.addColor(this.parameters, 'color2').onChange(enforceColors);
        this.gui.addColor(this.parameters, 'color3').onChange(enforceColors);
        this.enforceModel();
        enforceColors();
    }

    protected override update(): void { }

    private async enforceModel(): Promise<void> {
        this.container.clear();

        let characterPromise = this.characters.get(this.parameters.model);
        if (!characterPromise) {
            characterPromise = new Promise<Character>(async resolve => { // eslint-disable-line
                const [gltf, color1Texture, color2Texture, color3Texture] = await Promise.all([
                    this.gltfLoader.loadAsync(`/resources/character/${this.parameters.model}/${this.parameters.model}.glb`),
                    new THREE.TextureLoader().loadAsync(`/resources/character/${this.parameters.model}/color_01.png`),
                    new THREE.TextureLoader().loadAsync(`/resources/character/${this.parameters.model}/color_02.png`),
                    new THREE.TextureLoader().loadAsync(`/resources/character/${this.parameters.model}/color_03.png`),
                ]);

                let mesh = null as THREE.Mesh | null;
                gltf.scene.traverse(child => {
                    if ((child as any).isMesh) {
                        mesh = child as THREE.Mesh;
                    }
                });

                if (!mesh) {
                    throw new Error(`No mesh for "${this.parameters.model}".`);
                }

                const material = mesh.material as THREE.MeshPhongMaterial;

                const childTexture = material.map;
                if (!childTexture) {
                    throw new Error('No base texture');
                }

                const customizableTexture = new CustomizableTexture({
                    baseTexture: childTexture,
                    additionalTextures: new Map<string, THREE.Texture>([
                        ['color1', color1Texture],
                        ['color2', color2Texture],
                        ["color3", color3Texture],
                    ]),
                });
                material.map = customizableTexture.texture;

                resolve({ scene: gltf.scene, customizableTexture });
            });
            characterPromise.then(character => {
                this.characters.set(this.parameters.model, character);
            });
            this.characters.set(this.parameters.model, characterPromise);
        }

        const character = await characterPromise;
        this.container.clear();
        this.container.add(character.scene);
        this.enforceColors();
    }

    private enforceColors(): void {
        const character = this.characters.get(this.parameters.model);
        if (character && !(character instanceof Promise)) {
            character.customizableTexture.setLayerColor('color1', new THREE.Color(this.parameters.color1));
            character.customizableTexture.setLayerColor('color2', new THREE.Color(this.parameters.color2));
            character.customizableTexture.setLayerColor('color3', new THREE.Color(this.parameters.color3));
            character.customizableTexture.update(this.renderer);
        }
    }
}

export { TestTextureCustomization };
