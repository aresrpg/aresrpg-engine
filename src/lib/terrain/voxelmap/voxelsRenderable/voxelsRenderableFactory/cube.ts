import * as THREE from '../../../../libs/three-usage';

const vertices = {
    ppp: new THREE.Vector3(1, 1, 1),
    mpp: new THREE.Vector3(0, 1, 1),
    pmp: new THREE.Vector3(1, 0, 1),
    mmp: new THREE.Vector3(0, 0, 1),
    ppm: new THREE.Vector3(1, 1, 0),
    mpm: new THREE.Vector3(0, 1, 0),
    pmm: new THREE.Vector3(1, 0, 0),
    mmm: new THREE.Vector3(0, 0, 0),
};
type FaceVertex = {
    readonly vertex: THREE.Vector3Like;
    readonly shadowingNeighbourVoxels: [THREE.Vector3Like, THREE.Vector3Like, THREE.Vector3Like];
    readonly edgeNeighbourVoxels: {
        readonly x: [THREE.Vector3Like, THREE.Vector3Like];
        readonly y: [THREE.Vector3Like, THREE.Vector3Like];
    };
};

type FaceType = 'up' | 'down' | 'left' | 'right' | 'front' | 'back';

const normals: Record<FaceType, THREE.Vector3> = {
    up: new THREE.Vector3(0, +1, 0),
    down: new THREE.Vector3(0, -1, 0),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(+1, 0, 0),
    front: new THREE.Vector3(0, 0, +1),
    back: new THREE.Vector3(0, 0, -1),
};
const normalsById = Object.values(normals);

type Normal = {
    readonly id: number;
    readonly vec: THREE.Vector3Like;
};

function buildNormal(vec: THREE.Vector3Like): Normal {
    for (let i = 0; i < normalsById.length; i++) {
        if (normalsById[i]!.equals(vec)) {
            return {
                id: i,
                vec,
            };
        }
    }
    throw new Error('Invalid normal');
}

type Face = {
    readonly id: number;
    readonly type: FaceType;
    readonly vertices: [FaceVertex, FaceVertex, FaceVertex, FaceVertex];
    readonly normal: Normal;
    readonly uvUp: Normal;
    readonly uvRight: Normal;
};

const faceIndices: [number, number, number, number, number, number] = [0, 2, 1, 1, 2, 3];

let iF = 0;

function buildFace(type: FaceType, v00: THREE.Vector3Like, v01: THREE.Vector3Like, v10: THREE.Vector3Like, v11: THREE.Vector3Like): Face {
    const normal = normals[type];
    const uvUp = new THREE.Vector3().subVectors(v01, v00);
    const uvRight = new THREE.Vector3().subVectors(v10, v00);
    const uvLeft = uvRight.clone().multiplyScalar(-1);
    const uvDown = uvUp.clone().multiplyScalar(-1);

    return {
        id: iF++,
        type,
        vertices: [
            {
                vertex: v00,
                shadowingNeighbourVoxels: [
                    new THREE.Vector3().subVectors(normal, uvRight),
                    new THREE.Vector3().subVectors(normal, uvUp),
                    new THREE.Vector3().subVectors(normal, uvRight).sub(uvUp),
                ],
                edgeNeighbourVoxels: {
                    x: [uvLeft, new THREE.Vector3().addVectors(uvLeft, normal)],
                    y: [uvDown, new THREE.Vector3().addVectors(uvDown, normal)],
                },
            },
            {
                vertex: v01,
                shadowingNeighbourVoxels: [
                    new THREE.Vector3().subVectors(normal, uvRight),
                    new THREE.Vector3().addVectors(normal, uvUp),
                    new THREE.Vector3().subVectors(normal, uvRight).add(uvUp),
                ],
                edgeNeighbourVoxels: {
                    x: [uvLeft, new THREE.Vector3().addVectors(uvLeft, normal)],
                    y: [uvUp, new THREE.Vector3().addVectors(uvUp, normal)],
                },
            },
            {
                vertex: v10,
                shadowingNeighbourVoxels: [
                    new THREE.Vector3().addVectors(normal, uvRight),
                    new THREE.Vector3().subVectors(normal, uvUp),
                    new THREE.Vector3().addVectors(normal, uvRight).sub(uvUp),
                ],
                edgeNeighbourVoxels: {
                    x: [uvRight, new THREE.Vector3().addVectors(uvRight, normal)],
                    y: [uvDown, new THREE.Vector3().addVectors(uvDown, normal)],
                },
            },
            {
                vertex: v11,
                shadowingNeighbourVoxels: [
                    new THREE.Vector3().addVectors(normal, uvRight),
                    new THREE.Vector3().addVectors(normal, uvUp),
                    new THREE.Vector3().addVectors(normal, uvRight).add(uvUp),
                ],
                edgeNeighbourVoxels: {
                    x: [uvRight, new THREE.Vector3().addVectors(uvRight, normal)],
                    y: [uvUp, new THREE.Vector3().addVectors(uvUp, normal)],
                },
            },
        ],
        normal: buildNormal(normal),
        uvUp: buildNormal(uvUp),
        uvRight: buildNormal(uvRight),
    };
}

const faces: Record<FaceType, Face> = {
    up: buildFace('up', vertices.mpp, vertices.mpm, vertices.ppp, vertices.ppm),
    down: buildFace('down', vertices.mmm, vertices.mmp, vertices.pmm, vertices.pmp),
    left: buildFace('left', vertices.mmm, vertices.mpm, vertices.mmp, vertices.mpp),
    right: buildFace('right', vertices.pmp, vertices.ppp, vertices.pmm, vertices.ppm),
    front: buildFace('front', vertices.mmp, vertices.mpp, vertices.pmp, vertices.ppp),
    back: buildFace('back', vertices.pmm, vertices.ppm, vertices.mmm, vertices.mpm),
};
const facesById = Object.values(faces).sort((face1: Face, face2: Face) => face1.id - face2.id);

export { faceIndices, faces, facesById, normalsById, type Face, type FaceType, type FaceVertex };
