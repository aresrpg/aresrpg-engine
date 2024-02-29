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
    readonly uAmbient: { value: number };
    readonly uDiffuse: { value: number };
};

type PatchMaterial = THREE.Material & {
    readonly uniforms: PatchMaterialUniforms;
};

export {
    EDisplayMode,
    EMaterial,
    type PatchMaterial,
    type PatchMaterialUniforms
};

