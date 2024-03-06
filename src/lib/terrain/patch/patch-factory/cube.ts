import * as THREE from '../../../three-usage'
import { ENeighbour } from '../../i-voxel-map'

const vertices = {
  ppp: new THREE.Vector3(1, 1, 1),
  mpp: new THREE.Vector3(0, 1, 1),
  pmp: new THREE.Vector3(1, 0, 1),
  mmp: new THREE.Vector3(0, 0, 1),
  ppm: new THREE.Vector3(1, 1, 0),
  mpm: new THREE.Vector3(0, 1, 0),
  pmm: new THREE.Vector3(1, 0, 0),
  mmm: new THREE.Vector3(0, 0, 0),
}
type FaceVertex = {
  readonly vertex: THREE.Vector3
  readonly shadowingNeighbourVoxels: [ENeighbour, ENeighbour, ENeighbour]
  readonly edgeNeighbourVoxels: {
    readonly x: [ENeighbour, ENeighbour]
    readonly y: [ENeighbour, ENeighbour]
  }
}

type FaceType = 'up' | 'down' | 'left' | 'right' | 'front' | 'back'

const normals: Record<FaceType, THREE.Vector3> = {
  up: new THREE.Vector3(0, +1, 0),
  down: new THREE.Vector3(0, -1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(+1, 0, 0),
  front: new THREE.Vector3(0, 0, +1),
  back: new THREE.Vector3(0, 0, -1),
}

type Face = {
  readonly id: number
  readonly type: FaceType
  readonly vertices: [FaceVertex, FaceVertex, FaceVertex, FaceVertex]
  readonly normal: THREE.Vector3
  readonly uvUp: THREE.Vector3
  readonly uvRight: THREE.Vector3
  readonly facingNeighbour: ENeighbour;
}

const faceIndices: [number, number, number, number, number, number] = [
  0, 2, 1, 1, 2, 3,
]

let iF = 0

function buildFace(
  type: FaceType,
  v00: THREE.Vector3,
  v01: THREE.Vector3,
  v10: THREE.Vector3,
  v11: THREE.Vector3,
): Face {
  const normal = normals[type]
  const uvUp = new THREE.Vector3().subVectors(v01, v00)
  const uvRight = new THREE.Vector3().subVectors(v10, v00)
  const uvLeft = uvRight.clone().multiplyScalar(-1)
  const uvDown = uvUp.clone().multiplyScalar(-1)

  const getValueCode = (value: number): string => {
    if (value === -1) {
      return "M";
    } else if (value === 1) {
      return "P";
    }
    return "0";
  };

  const getNeighbourCode = (vec3: THREE.Vector3): ENeighbour => {
    const key = `x${getValueCode(vec3.x)}y${getValueCode(vec3.y)}z${getValueCode(vec3.z)}`;
    const result = ENeighbour[key as any];
    if (typeof result === "undefined"){
      throw new Error("Should not happen");
    }
    return result as unknown as ENeighbour;
  };

  return {
    id: iF++,
    type,
    vertices: [
      {
        vertex: v00,
        shadowingNeighbourVoxels: [
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvRight)),
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvUp)),
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvRight).sub(uvUp)),
        ],
        edgeNeighbourVoxels: {
          x: [getNeighbourCode(uvLeft), getNeighbourCode(new THREE.Vector3().addVectors(uvLeft, normal))],
          y: [getNeighbourCode(uvDown), getNeighbourCode(new THREE.Vector3().addVectors(uvDown, normal))],
        },
      },
      {
        vertex: v01,
        shadowingNeighbourVoxels: [
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvRight)),
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvUp)),
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvRight).add(uvUp)),
        ],
        edgeNeighbourVoxels: {
          x: [getNeighbourCode(uvLeft), getNeighbourCode(new THREE.Vector3().addVectors(uvLeft, normal))],
          y: [getNeighbourCode(uvUp),   getNeighbourCode(new THREE.Vector3().addVectors(uvUp, normal))],
        },
      },
      {
        vertex: v10,
        shadowingNeighbourVoxels: [
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvRight)),
          getNeighbourCode(new THREE.Vector3().subVectors(normal, uvUp)),
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvRight).sub(uvUp)),
        ],
        edgeNeighbourVoxels: {
          x: [getNeighbourCode(uvRight), getNeighbourCode(new THREE.Vector3().addVectors(uvRight, normal))],
          y: [getNeighbourCode(uvDown),  getNeighbourCode(new THREE.Vector3().addVectors(uvDown, normal))],
        },
      },
      {
        vertex: v11,
        shadowingNeighbourVoxels: [
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvRight)),
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvUp)),
          getNeighbourCode(new THREE.Vector3().addVectors(normal, uvRight).add(uvUp)),
        ],
        edgeNeighbourVoxels: {
          x: [getNeighbourCode(uvRight), getNeighbourCode(new THREE.Vector3().addVectors(uvRight, normal))],
          y: [getNeighbourCode(uvUp),    getNeighbourCode(new THREE.Vector3().addVectors(uvUp, normal))],
        },
      },
    ],
    normal,
    uvUp,
    uvRight,
    facingNeighbour: getNeighbourCode(normal),
  }
}

const faces: Record<FaceType, Face> = {
  up: buildFace('up', vertices.mpp, vertices.mpm, vertices.ppp, vertices.ppm),
  down: buildFace(
    'down',
    vertices.mmm,
    vertices.mmp,
    vertices.pmm,
    vertices.pmp,
  ),
  left: buildFace(
    'left',
    vertices.mmm,
    vertices.mpm,
    vertices.mmp,
    vertices.mpp,
  ),
  right: buildFace(
    'right',
    vertices.pmp,
    vertices.ppp,
    vertices.pmm,
    vertices.ppm,
  ),
  front: buildFace(
    'front',
    vertices.mmp,
    vertices.mpp,
    vertices.pmp,
    vertices.ppp,
  ),
  back: buildFace(
    'back',
    vertices.pmm,
    vertices.ppm,
    vertices.mmm,
    vertices.mpm,
  ),
}
const facesById = Object.values(faces).sort(
  (face1: Face, face2: Face) => face1.id - face2.id,
)

export { faceIndices, faces, facesById, type FaceType, type FaceVertex }
