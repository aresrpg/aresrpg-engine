type Uint3 = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};

type Color = {
    readonly r: number;
    readonly g: number;
    readonly b: number; 
};

interface IVoxelMaterial {
    readonly color: Color;
}

interface IVoxel {
    readonly position: Uint3;
    readonly typeId: number;
}

interface IVoxelMap {
    readonly size: Uint3;

    getAllVoxelMaterials(): IVoxelMaterial[];
    getMaxVoxelsCount(from: Uint3, to: Uint3): number;
    iterateOnVoxels(from: Uint3, to: Uint3): Generator<IVoxel>;
    voxelExists(x: number, y: number, z: number): boolean;
}

export type {
    IVoxel, IVoxelMap, IVoxelMaterial
};

