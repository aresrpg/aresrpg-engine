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

interface ILocalMapData {
    readonly data: Uint16Array;
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

    getLocalMapData(from: Vector3Like, to: Vector3Like): Promise<ILocalMapData>;
}

export type { IVoxelMap, IVoxelMaterial, ILocalMapData };
