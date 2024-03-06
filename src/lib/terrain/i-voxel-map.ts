type Uint3 = {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * A color stored in RGB format. Each component should be normalized.
 */
type Color = {
  readonly r: number
  readonly g: number
  readonly b: number
}

interface IVoxelMaterial {
  readonly color: Color
}

enum ENeighbour {
  xMyMzM = 0,  // whether or not there is a neighbour voxel at coords { X - 1, Y - 1, Z - 1 }
  xMyMz0 = 1,  // whether or not there is a neighbour voxel at coords { X - 1, Y - 1, Z     }
  xMyMzP = 2,  // whether or not there is a neighbour voxel at coords { X - 1, Y - 1, Z + 1 }
  xMy0zM = 3,  // whether or not there is a neighbour voxel at coords { X - 1, Y    , Z - 1 }
  xMy0z0 = 4,  // whether or not there is a neighbour voxel at coords { X - 1, Y    , Z     }
  xMy0zP = 5,  // whether or not there is a neighbour voxel at coords { X - 1, Y    , Z + 1 }
  xMyPzM = 6,  // whether or not there is a neighbour voxel at coords { X - 1, Y + 1, Z - 1 }
  xMyPz0 = 7,  // whether or not there is a neighbour voxel at coords { X - 1, Y + 1, Z     }
  xMyPzP = 8,  // whether or not there is a neighbour voxel at coords { X - 1, Y + 1, Z + 1 }
  x0yMzM = 9,  // whether or not there is a neighbour voxel at coords { X    , Y - 1, Z - 1 }
  x0yMz0 = 10, // whether or not there is a neighbour voxel at coords { X    , Y - 1, Z     }
  x0yMzP = 11, // whether or not there is a neighbour voxel at coords { X    , Y - 1, Z + 1 }
  x0y0zM = 12, // whether or not there is a neighbour voxel at coords { X    , Y    , Z - 1 }
  x0y0zP = 13, // whether or not there is a neighbour voxel at coords { X    , Y    , Z + 1 }
  x0yPzM = 14, // whether or not there is a neighbour voxel at coords { X    , Y + 1, Z - 1 }
  x0yPz0 = 15, // whether or not there is a neighbour voxel at coords { X    , Y + 1, Z     }
  x0yPzP = 16, // whether or not there is a neighbour voxel at coords { X    , Y + 1, Z + 1 }
  xPyMzM = 17, // whether or not there is a neighbour voxel at coords { X + 1, Y - 1, Z - 1 }
  xPyMz0 = 18, // whether or not there is a neighbour voxel at coords { X + 1, Y - 1, Z     }
  xPyMzP = 19, // whether or not there is a neighbour voxel at coords { X + 1, Y - 1, Z + 1 }
  xPy0zM = 20, // whether or not there is a neighbour voxel at coords { X + 1, Y    , Z - 1 }
  xPy0z0 = 21, // whether or not there is a neighbour voxel at coords { X + 1, Y    , Z     }
  xPy0zP = 22, // whether or not there is a neighbour voxel at coords { X + 1, Y    , Z + 1 }
  xPyPzM = 23, // whether or not there is a neighbour voxel at coords { X + 1, Y + 1, Z - 1 }
  xPyPz0 = 24, // whether or not there is a neighbour voxel at coords { X + 1, Y + 1, Z     }
  xPyPzP = 25, // whether or not there is a neighbour voxel at coords { X + 1, Y + 1, Z + 1 }
}

/**
 * A representation of a voxel.
 */
interface IVoxel {
  readonly position: Uint3
  readonly materialId: number
  readonly neighbours: Record<ENeighbour, boolean>;
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
  readonly size: Uint3

  /**
   * @returns an array of all the possible voxel materials contained in the map.
   * Each material is then identified by its index in the array.
   */
  readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>

  /**
   * @param from Start of the subsection
   * @param to End of the subsection (exclusive)
   * @returns An upper bound of the count of voxels withing the given sub-section of the map.
   */
  getMaxVoxelsCount(from: Uint3, to: Uint3): number

  /**
   * Iterates on all for voxels within a given sub-section of the map.
   * @param from Start of the subsection
   * @param to End of the subsection (exclusive)
   */
  iterateOnVoxels(from: Uint3, to: Uint3): Generator<IVoxel>

  /**
   * @returns whether or not a voxel exists at these coordinates.
   */
  voxelExists(x: number, y: number, z: number): boolean
}

export type { IVoxel, IVoxelMap, IVoxelMaterial };
export { ENeighbour };
