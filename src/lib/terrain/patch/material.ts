import * as THREE from '../../three-usage';

enum EMaterial {
    ROCK = 0,
    GRASS = 1,
}

enum EDisplayMode {
    TEXTURES,
    NORMALS,
    GREY,
}

type PatchMaterialUniforms = {
    readonly uDisplayMode: { value: EDisplayMode };
    readonly uTexture: { value: THREE.Texture };
    readonly uNoiseTexture: { value: THREE.Texture };
    readonly uNoiseStrength: { value: number };
    readonly uAoStrength: { value: number };
    readonly uAoSpread: { value: number };
    readonly uSmoothEdgeRadius: { value: number };
    readonly uSmoothEdgeMethod: { value: number };

    readonly uLightColor: { value: THREE.Color };
    readonly uAmbientIntensity: { value: number };
    readonly uDiffuseDirection: { value: THREE.Vector3 };
    readonly uDiffuseIntensity: { value: number };
};

type PatchMaterial = THREE.Material & {
    readonly userData: {
        readonly uniforms: PatchMaterialUniforms;
    };
};

type PatchMaterials = {
    readonly material: PatchMaterial;
    readonly shadowMaterial: THREE.Material;
};

export { EDisplayMode, EMaterial, type PatchMaterial, type PatchMaterials, type PatchMaterialUniforms };
