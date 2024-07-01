import * as THREE from '../../../three-usage';

enum EVoxelsDisplayMode {
    TEXTURED,
    NORMALS,
    GREY,
}

type VoxelsMaterialUniforms = {
    readonly uDisplayMode: { value: EVoxelsDisplayMode };
    readonly uTexture: { value: THREE.Texture };
    readonly uNoiseTexture: { value: THREE.Texture };
    readonly uNoiseStrength: { value: number };
    readonly uAoStrength: { value: number };
    readonly uAoSpread: { value: number };
    readonly uSmoothEdgeRadius: { value: number };
    readonly uSmoothEdgeMethod: { value: number };
};

type VoxelsMaterial = THREE.Material & {
    readonly userData: {
        readonly uniforms: VoxelsMaterialUniforms;
    };
};

type VoxelsMaterials = {
    readonly material: VoxelsMaterial;
    readonly shadowMaterial: THREE.Material;
};

export { EVoxelsDisplayMode, type VoxelsMaterial, type VoxelsMaterialUniforms, type VoxelsMaterials };
