type Uint3 = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};

/**
 * A color stored in RGB format. Each component should be normalized.
 */
type Color = {
    readonly r: number;
    readonly g: number;
    readonly b: number;
};

interface IVoxelMaterial {
    readonly color: Color;
}

/**
 * A representation of a voxel.
 */
interface IVoxel {
    readonly position: Uint3;
    readonly materialId: number;
}

/**
 * Interface for a class storing a 3D voxel map.
 * Each voxel should have positive integer coordinates.
 * The map starts at coordinates { x: 0, y: 0, z: 0 }.
 */
interface IVoxelMap {
    /**
     * Size of the map. Should be integers.
     *
     * Since the coordinates start at { x: 0, y: 0, z: 0 }, this means that
     * the higher coordinates are { x: size.x - 1, y: size.y - 1, z: size.z - 1 }.
     */
    readonly size: Uint3;

    /**
     * @returns an array of all the possible voxel materials contained in the map.
     * Each material is then identified by its index in the array.
     */
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;

    /**
     * @param from Start of the subsection
     * @param to End of the subsection (exclusive)
     * @returns An upper bound of the count of voxels withing the given sub-section of the map.
     */
    getMaxVoxelsCount(from: Uint3, to: Uint3): number;

    /**
     * Iterates on all for voxels within a given sub-section of the map.
     * @param from Start of the subsection
     * @param to End of the subsection (exclusive)
     */
    iterateOnVoxels(from: Uint3, to: Uint3): Generator<IVoxel>;

    /**
     * @returns whether or not a voxel exists at these coordinates.
     */
    voxelExists(x: number, y: number, z: number): boolean;
}

export type { IVoxel, IVoxelMap, IVoxelMaterial };
