import { type Vector3Like } from '../../libs/three-usage';

import { VoxelmapDataPacking } from './voxelmap-data-packing';

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
    readonly shininess?: number;
}

type VoxelsChunkSize = {
    readonly xz: number;
    readonly y: number;
};

type VoxelsChunkOrdering = 'xyz' | 'xzy' | 'yxz' | 'yzx' | 'zxy' | 'zyx';

/** Compact object storing a portion of the map data  */
type LocalMapData =
    | {
          /** Compact array storing the voxel data.
           * Each element in the array represent a coordinate in the map and stores the data of the voxel at these coordinates.
           * Each element should be encoded as follows:
           * - bit 0: 0 if the voxel is empty, 1 otherwise
           * - bit 1: 1 if the voxel should be displayed as checkerboard, 0 otherwise
           * - bits 2-13: ID of the material
           * Use the helper "voxelmapDataPacking" to do this encoding and be future-proof.
           */
          readonly data: Uint16Array;
          readonly dataOrdering: VoxelsChunkOrdering;
          readonly isEmpty: false;
      }
    | {
          readonly isEmpty: true;
      };

/**
 * Interface for a class storing a 3D voxel map.
 * Each voxel should have integer coordinates.
 */
interface IVoxelMap {
    readonly minAltitude: number;
    readonly maxAltitude: number;

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
    getLocalMapData(from: Vector3Like, to: Vector3Like): LocalMapData | Promise<LocalMapData>;
}

const voxelmapDataPacking = new VoxelmapDataPacking();

export { voxelmapDataPacking, type LocalMapData, type IVoxelMap, type IVoxelMaterial, type VoxelsChunkOrdering, type VoxelsChunkSize };
