import type * as THREE from '../../../libs/three-usage';

enum EVoxelsDisplayMode {
    TEXTURED,
    NORMALS,
    GREY,
}

type VoxelsMaterialUniforms = {
    readonly uDisplayMode: THREE.IUniform<EVoxelsDisplayMode>;
    readonly uTexture: THREE.IUniform<THREE.Texture>;
    readonly uDissolveRatio: THREE.IUniform<number>;
    readonly uNoiseTexture: THREE.IUniform<THREE.Texture>;
    readonly uNoiseStrength: THREE.IUniform<number>;
    readonly uCheckerboardStrength: THREE.IUniform<number>;
    readonly uAoStrength: THREE.IUniform<number>;
    readonly uAoSpread: THREE.IUniform<number>;
    readonly uSmoothEdgeRadius: THREE.IUniform<number>;
    readonly uGridThickness: THREE.IUniform<number>;
    readonly uGridColor: THREE.IUniform<THREE.Vector3>;
    readonly uShininessStrength: THREE.IUniform<number>;
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
