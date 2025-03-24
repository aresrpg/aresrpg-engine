import { clamp, nextPowerOfTwo } from '../helpers/math';
import * as THREE from '../libs/three-usage';

import { type IVoxelMaterial } from './voxelmap/i-voxelmap';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxShininess: number;
    readonly noiseModulation?: {
        readonly baseStrength: number;
        readonly fromColorValue: number;
        readonly toColorValue: number;
    };
};

class MaterialsStore {
    public readonly texture: THREE.DataTexture;
    public readonly materialsCount: number;
    public readonly glslDeclaration: string;

    private readonly maxShininess: number;
    private readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;

    public constructor(params: Parameters) {
        this.maxShininess = params.maxShininess;
        this.voxelMaterialsList = params.voxelMaterialsList;

        this.texture = this.buildMaterialsTexture(params.voxelMaterialsList);
        this.materialsCount = params.voxelMaterialsList.length;

        const noiseModulation = params.noiseModulation ?? {
            baseStrength: 0.2,
            fromColorValue: 0,
            toColorValue: 0.5,
        };
        const noiseModulationCode =
            noiseModulation.baseStrength > 1
                ? ''
                : `
    float distanceFromBlack = length(voxelMaterial.color);
    float distanceFromWhite = length(voxelMaterial.color - 1.0);
    float distanceFromExtreme = min(distanceFromBlack, distanceFromWhite);
    noise *= mix(
        ${noiseModulation.baseStrength.toFixed(3)},
        1.0,
        smoothstep(
            ${noiseModulation.fromColorValue.toFixed(3)},
            ${noiseModulation.toColorValue.toFixed(3)},
            distanceFromExtreme
        )
    );`;

        this.glslDeclaration = `
struct VoxelMaterial {
    vec3 color;
    float shininess;
    vec3 emissive;
};

VoxelMaterial getVoxelMaterial(const in uint materialId, const in sampler2D materialsTexture, float noise) {
    VoxelMaterial voxelMaterial;
    ivec2 texelCoords = ivec2(materialId % ${this.texture.image.width}u, materialId / ${this.texture.image.width}u);
    vec4 fetchedTexel = texelFetch(materialsTexture, texelCoords, 0);
    voxelMaterial.color = fetchedTexel.rgb;
    ${noiseModulationCode}
    voxelMaterial.color += noise;

    float emissive = step(0.5, fetchedTexel.a) * (2.0 * fetchedTexel.a - 1.0);
    voxelMaterial.shininess = step(fetchedTexel.a, 0.5) * ${this.maxShininess.toFixed(1)} * 2.0 * fetchedTexel.a * (1.0 + 10.0 * noise);
    voxelMaterial.emissive = emissive * voxelMaterial.color;
    voxelMaterial.color *= (1.0 - emissive);
    return voxelMaterial;
}
`;
    }

    public dispose(): void {
        this.texture.dispose();
    }

    public getVoxelMaterial(materialId: number): IVoxelMaterial {
        const voxelMaterial = this.voxelMaterialsList[materialId];
        if (!voxelMaterial) {
            throw new Error();
        }
        return voxelMaterial;
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
