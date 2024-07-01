import * as THREE from '../../three-usage';

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

export { EDisplayMode, type PatchMaterial, type PatchMaterialUniforms, type PatchMaterials };
