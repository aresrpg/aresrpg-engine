import type { Vector3Like } from '../three-usage';

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

/** Compact object storing a portion of the map data  */
interface ILocalMapData {
    /** Compact array storing the voxel data.
     * Each element in the array represent a coordinate in the map and stores the data of the voxel at these coordinates.
     * An element:
     * - should be equal to 0 if there is no voxel at these coordinates
     * - should be equal to the voxel's material id + 1 if there is a voxel at these coordinates
     *
     * The elements should be ordered by coordinates as follow by Z first, then Y then X.
     * For example, for a portion of the map between (0,0,0) and (2,2,2): (0,0,0) then (1,0,0) then (0,1,0) then (1,1,0) then (0,1,1) then (1,1,1)
     */
    readonly data: Uint16Array;

    /** Should be:
     * - true if there are no voxels in the data
     * - false if there is at least one voxel in the data
     */
    readonly isEmpty: boolean;
}

/**
 * Interface for a class storing a 3D voxel map.
 * Each voxel should have integer coordinates.
 */
interface IVoxelMap {
    /**
     * @returns an array of all the possible voxel materials contained in the map.
     * Each material is then identified by its index in the array.
     */
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;

    /**
     * @returns an object storing the voxels data for the specified portion of the map.
     * @param from Lower limit (inclusive) for the voxels coordinates
     * @param to Upper limit (exclusive) for the voxels coordinates
     */
    getLocalMapData(from: Vector3Like, to: Vector3Like): Promise<ILocalMapData>;
}

export type { IVoxelMap, IVoxelMaterial, ILocalMapData };
