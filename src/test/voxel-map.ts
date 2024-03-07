import { createNoise2D } from 'simplex-noise'
import * as THREE from 'three'

import { AresRpgEngine } from '../lib/index'
import { VoxelGrid } from './storage/grid/voxel-grid'
import { IVoxelStorage } from './storage/i-voxel-storage'
import { VoxelOctree } from './storage/octree/voxel-octree'

enum EVoxelType {
  ROCK,
  GRASS,
  SNOW,
  WATER,
  SAND,
}

const voxelMaterials: Record<EVoxelType, AresRpgEngine.IVoxelMaterial> = [
  { color: new THREE.Color('#ABABAB') },
  { color: new THREE.Color('#00B920') },
  { color: new THREE.Color('#E5E5E5') },
  { color: new THREE.Color('#0055E2') },
  { color: new THREE.Color('#DCBE28') },
]

type StoredVoxel = {
  readonly y: number
  readonly type: EVoxelType
}

class VoxelMap implements AresRpgEngine.IVoxelMap {
  public readonly size: THREE.Vector3
  public readonly voxelMaterialsList = Object.values(voxelMaterials)

  private readonly voxels: ReadonlyArray<StoredVoxel>
  private readonly storage: IVoxelStorage;

  public constructor(width: number, height: number, altitude: number) {
    this.size = new THREE.Vector3(width, altitude, height)
    this.storage = new VoxelGrid();
    // this.storage = VoxelOctree.create(Math.max(width, altitude, height));

    const noise2D = createNoise2D()

    const voxels: StoredVoxel[] = []
    for (let iX = 0; iX < this.size.x; iX++) {
      for (let iZ = 0; iZ < this.size.z; iZ++) {
        const yNoise = 0.5 + 0.5 * noise2D(iX / 50, iZ / 50)
        const iY = Math.floor(yNoise * this.size.y)
        const id = this.buildId(iX, iZ)

        let type: EVoxelType
        if (iY < 0.1 * altitude) {
          type = EVoxelType.WATER
        } else if (iY < 0.3 * altitude) {
          type = EVoxelType.SAND
        } else if (iY < 0.75 * altitude) {
          type = EVoxelType.GRASS
        } else if (iY < 0.85 * altitude) {
          type = EVoxelType.ROCK
        } else {
          type = EVoxelType.SNOW
        }
        voxels[id] = {
          y: iY,
          type,
        }

        // for (let y = 0; y <= iY; y++) {
          this.storage.setVoxelMaterial(new THREE.Vector3(iX, iY, iZ), type);
        // }
      }
    }
    this.voxels = voxels

    console.log(
      `Generated map of size ${this.size.x}x${this.size.y}x${this.size.z
      } (${this.voxels.length.toLocaleString()} voxels)`,
    )
  }

  public getMaxVoxelsCount(from: THREE.Vector3, to: THREE.Vector3): number {
    const fromX = Math.max(from.x, 0)
    const fromZ = Math.max(from.z, 0)

    const toX = Math.min(to.x, this.size.x)
    const toZ = Math.min(to.z, this.size.z)

    return (toX - fromX) * (toZ - fromZ)
  }

  public *iterateOnVoxels(
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): Generator<AresRpgEngine.IVoxel> {
    if (to.x < from.x || to.y < from.y || to.z < from.z) {
      throw new Error()
    }

    for (const voxel of this.storage.iterateOnVoxels(from, to)) {
      const neighbours: Record<AresRpgEngine.ENeighbour, boolean> = [
        this.voxelExists(voxel.position.x - 1, voxel.position.y - 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x - 1, voxel.position.y - 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x - 1, voxel.position.y - 1, voxel.position.z + 1),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 0, voxel.position.z - 1),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 0, voxel.position.z + 0),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 0, voxel.position.z + 1),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x - 1, voxel.position.y + 1, voxel.position.z + 1),

        this.voxelExists(voxel.position.x + 0, voxel.position.y - 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 0, voxel.position.y - 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x + 0, voxel.position.y - 1, voxel.position.z + 1),
        this.voxelExists(voxel.position.x + 0, voxel.position.y + 0, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 0, voxel.position.y + 0, voxel.position.z + 1),
        this.voxelExists(voxel.position.x + 0, voxel.position.y + 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 0, voxel.position.y + 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x + 0, voxel.position.y + 1, voxel.position.z + 1),

        this.voxelExists(voxel.position.x + 1, voxel.position.y - 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 1, voxel.position.y - 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x + 1, voxel.position.y - 1, voxel.position.z + 1),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 0, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 0, voxel.position.z + 0),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 0, voxel.position.z + 1),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 1, voxel.position.z - 1),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 1, voxel.position.z + 0),
        this.voxelExists(voxel.position.x + 1, voxel.position.y + 1, voxel.position.z + 1),
      ];

      yield {
        position: voxel.position,
        materialId: voxel.materialId,
        neighbours,
      }
    }
  }

  public voxelExists(x: number, y: number, z: number): boolean {
    return this.storage.doesVoxelExist(new THREE.Vector3(x, y, z));
    // const voxel = this.getVoxel(x, z)
    // return voxel?.y === y
  }

  private buildId(x: number, z: number): number {
    return x * this.size.z + z
  }
}

export { VoxelMap }

