import type * as THREE from '../../../libs/three-usage';

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
    readonly uCheckerboardStrength: { value: number };
    readonly uAoStrength: { value: number };
    readonly uAoSpread: { value: number };
    readonly uSmoothEdgeRadius: { value: number };
    readonly uGridThickness: { value: number };
    readonly uGridColor: { value: THREE.Vector3 };
};

type VoxelsMaterial = THREE.Material & {
    readonly userData: {
        readonly uniforms: VoxelsMaterialUniforms;
    };
};

enum EVoxelMaterialQuality {
    LOW = 0,
    HIGH = 1,
}

type VoxelsMaterials = {
    readonly materials: Record<EVoxelMaterialQuality, VoxelsMaterial>;
    readonly shadowMaterial: THREE.Material;
};

export { EVoxelMaterialQuality, EVoxelsDisplayMode, type VoxelsMaterial, type VoxelsMaterialUniforms, type VoxelsMaterials };
