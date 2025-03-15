import type * as THREE from '../../libs/three-usage';

import { VoxelEncoder } from './encoding/voxel-encoder';

interface IVoxelMaterial {
    /**
     * A color stored in RGB format. Each component should be normalized.
     */
    readonly color: {
        readonly r: number;
        readonly g: number;
        readonly b: number;
    };
    readonly shininess?: number;
    readonly emissiveness?: number;
}

interface IClutterDefinition {
    readonly geometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
}

type VoxelsChunkSize = {
    readonly xz: number;
    readonly y: number;
};

type VoxelsChunkOrdering = 'xyz' | 'xzy' | 'yxz' | 'yzx' | 'zxy' | 'zyx';

enum EVoxelType {
    SOLID = 0b00,
    CLUTTER = 0b01,
}

/** Compact object storing a portion of the map data  */
type LocalMapData =
    | {
          /** Compact array storing the voxel data.
           * Each element in the array represent a coordinate in the map and stores the data of the voxel at these coordinates.
           *
           * Each element should be encoded as follows:
           * - bit 0: 0 if the voxel is empty, 1 otherwise
           * - bits 1-13: data specific to the voxel type
           * - bits 14-15: voxel type
           *
           * If the voxel is not empty and voxel type is "EVoxelType.SOLID", then the voxel is of type SOLID and bits 1-13 are interpreted as follows:
           * - bit 1: 1 if the voxel should be displayed as checkerboard, 0 otherwise
           * - bits 2-13: ID of the material
           *
           * If the voxel is not empty and voxel type is "EVoxelType.CLUTTER", then the voxel is of type CLUTTER and bits 1-13 are interpreted as follows:
           * - bit 1-10: ID of the clutter
           * - bits 11-13: items count for this voxel
           *
           * Use the helper "voxelEncoder" to do this encoding and be future-proof.
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
    readonly altitude: {
        readonly min: number;
        readonly max: number;
    };

    readonly voxelTypesDefininitions: {
        /**
         * Array of all the possible voxel materials contained in the map.
         * Each material is then identified by its index in the array.
         */
        readonly solidMaterials: ReadonlyArray<IVoxelMaterial>;

        /**
         * Array of all the possible clutter definitions contained in the map.
         * Each clutter is then identified by its index in the array.
         */
        readonly clutterVoxels: ReadonlyArray<IClutterDefinition>;
    };

    /**
     * @returns an object storing the voxels data for the specified portion of the map.
     * @param from Lower limit (inclusive) for the voxels coordinates
     * @param to Upper limit (exclusive) for the voxels coordinates
     */
    getLocalMapData(from: THREE.Vector3Like, to: THREE.Vector3Like): LocalMapData | Promise<LocalMapData>;
}

const voxelEncoder = new VoxelEncoder();

export {
    EVoxelType,
    voxelEncoder,
    type IClutterDefinition,
    type IVoxelMap,
    type IVoxelMaterial,
    type LocalMapData,
    type VoxelsChunkOrdering,
    type VoxelsChunkSize,
};
