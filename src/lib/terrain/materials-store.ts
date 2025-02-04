import { clamp, nextPowerOfTwo } from '../helpers/math';
import * as THREE from '../libs/three-usage';

import { type IVoxelMaterial } from './voxelmap/i-voxelmap';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxShininess: number;
};

class MaterialsStore {
    public readonly texture: THREE.DataTexture;

    private readonly maxShininess: number;

    public readonly materialsCount: number;

    public readonly glslDeclaration: string;

    public constructor(params: Parameters) {
        this.maxShininess = params.maxShininess;
        this.texture = this.buildMaterialsTexture(params.voxelMaterialsList);
        this.materialsCount = params.voxelMaterialsList.length;

        this.glslDeclaration = `
struct VoxelMaterial {
    vec3 color;
    float shininess;
    vec3 emissive;
};

VoxelMaterial getVoxelMaterial(const in uint materialId) {
    VoxelMaterial voxelMaterial;
    ivec2 texelCoords = ivec2(voxelMaterialId % ${this.texture.image.width}u, voxelMaterialId / ${this.texture.image.width}u);
    vec4 fetchedTexel = texelFetch(uTexture, texelCoords, 0);
    voxelMaterial.color = fetchedTexel.rgb + noise;

    float emissive = step(0.5, fetchedTexel.a) * (2.0 * fetchedTexel.a - 1.0);
    voxelMaterial.shininess = 0.0001 + step(fetchedTexel.a, 0.5) * uShininessStrength * ${this.maxShininess.toFixed(1)} * 2.0 * fetchedTexel.a * (1.0 + 10.0 * noise);
    voxelMaterial.emissive = emissive * voxelMaterial.color;
    voxelMaterial.color *= (1.0 - emissive);
    return voxelMaterial;
`;
    }

    public dispose(): void {
        this.texture.dispose();
    }

    private buildMaterialsTexture(voxelMaterials: ReadonlyArray<IVoxelMaterial>): THREE.DataTexture {
        const voxelTypesCount = voxelMaterials.length;

        const maxTextureWidth = 256;
        const idealTextureWidth = nextPowerOfTwo(voxelTypesCount);
        const textureWidth = Math.min(idealTextureWidth, maxTextureWidth);
        const textureHeight = Math.ceil(voxelTypesCount / textureWidth);
        const textureData = new Uint8Array(4 * textureWidth * textureHeight);

        voxelMaterials.forEach((material: IVoxelMaterial, materialId: number) => {
            textureData[4 * materialId + 0] = 255 * material.color.r;
            textureData[4 * materialId + 1] = 255 * material.color.g;
            textureData[4 * materialId + 2] = 255 * material.color.b;
            const shininess = material.shininess ?? 0;
            const emissiveness = material.emissiveness ?? 0;

            if (shininess < 0) {
                throw new Error(`A material cannot have negative shininess.`);
            }
            if (emissiveness < 0) {
                throw new Error(`A material cannot have negative emissiveness.`);
            }
            if (emissiveness > 0 && shininess > 0) {
                throw new Error(`A material cannot both have shininess and emissiveness`);
            }

            if (emissiveness > 0) {
                // store emissiveness
                textureData[4 * materialId + 3] = 128 + clamp(127 * emissiveness, 0, 127);
            } else {
                // store shininess
                textureData[4 * materialId + 3] = clamp((127 * shininess) / this.maxShininess, 0, 127);
            }
        });
        const texture = new THREE.DataTexture(textureData, textureWidth, textureHeight);
        texture.needsUpdate = true;
        return texture;
    }
}

export { MaterialsStore };
