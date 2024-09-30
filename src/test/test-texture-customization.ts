import { GUI } from 'lil-gui';
import * as THREE from 'three-usage-test';

import { CustomizableTexture } from '../lib';

import { TestBase } from './test-base';

class TestTextureCustomization extends TestBase {
    private readonly gui: GUI;

    private readonly parameters = {
        color1: 0xff0000,
        color2: 0x00ff00,
        color3: 0x0000ff,
    };

    private customizableTexture: CustomizableTexture | null = null;

    public constructor() {
        super();

        this.camera.position.set(2, 2, 4);
        this.cameraControl.target.set(0, this.camera.position.y - 1.5, 0);

        const gridHelper = new THREE.GridHelper(1000, 100);
        gridHelper.position.setY(-0.01);
        this.scene.add(gridHelper);

        const ambientLight = new THREE.AmbientLight(0xCCCCCC);
        this.scene.add(ambientLight);

        const enforceColors = () => { this.enforceColors(); };
        this.gui = new GUI();
        this.gui.addColor(this.parameters, "color1").onChange(enforceColors);
        this.gui.addColor(this.parameters, "color2").onChange(enforceColors);
        this.gui.addColor(this.parameters, "color3").onChange(enforceColors);
        enforceColors();

        const gltfLoader = new THREE.GLTFLoader();
        const dracoLoader = new THREE.DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        dracoLoader.setDecoderConfig({ type: 'js' });
        gltfLoader.setDRACOLoader(dracoLoader);

        gltfLoader.load("/resources/character/primemachin.glb", gltf => {
            this.scene.add(gltf.scene);

            gltf.scene.traverse(child => {
                if ((child as any).isMesh) {
                    const childMesh = child as THREE.Mesh;
                    const childMaterial = childMesh.material as THREE.MeshPhongMaterial;

                    setTimeout(() => {
                        const childTexture = childMaterial.map;
                        if (!childTexture) {
                            throw new Error("No base texture");
                        }
                        this.customizableTexture = new CustomizableTexture({
                            width: 100,
                            height: 100,
                            baseTexture: childTexture,
                            additionalTextures: new Map<string, THREE.Texture>(),
                        });
                        this.customizableTexture.update(this.renderer);
                        childMaterial.map = this.customizableTexture.texture;
                    }, 2000);
                }
            })
        });
    }

    protected override update(): void {
    }

    private enforceColors(): void {
        if (this.customizableTexture) {
            // this.customizableTexture.setLayerColor("color1", new THREE.Color(this.parameters.color1));
            // this.customizableTexture.setLayerColor("color2", new THREE.Color(this.parameters.color2));
            // this.customizableTexture.setLayerColor("color3", new THREE.Color(this.parameters.color3));
            this.customizableTexture.update(this.renderer);
        }
    }
}

export { TestTextureCustomization };