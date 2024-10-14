import * as THREE from '../libs/three-usage';

import { EVoxelStatus, type VoxelmapCollider } from './voxelmap-collider';

type Parameters = {
    readonly voxelmapCollider: VoxelmapCollider;
};

type RayIntersection = {
    readonly distance: number;
    readonly point: THREE.Vector3Like;
};

type SphereIntersection = {
    readonly normal: THREE.Vector3;
    readonly depth: number;
};

function clamp(x: number, min: number, max: number): number {
    if (x < min) {
        return min;
    } else if (x > max) {
        return max;
    }
    return x;
}

class VoxelmapCollisions {
    private readonly voxelmapCollider: VoxelmapCollider;

    public constructor(params: Parameters) {
        this.voxelmapCollider = params.voxelmapCollider;
    }

    public rayCast(from: THREE.Vector3Like, to: THREE.Vector3Like): RayIntersection | null {
        type Candidate = {
            readonly distance: number;
            readonly voxelId: THREE.Vector3Like;
        };

        const delta = new THREE.Vector3().subVectors(to, from);
        const maxDistance = delta.length();
        const direction = new THREE.Vector3().copy(delta).normalize();

        const coords = new THREE.Vector3();
        const candidates: Candidate[] = [];
        const addCandidates = (direction: THREE.Vector3Like): void => {
            const fromW = direction.x * from.x + direction.y * from.y + direction.z * from.z;
            const toW = direction.x * to.x + direction.y * to.y + direction.z * to.z;
            const deltaW = direction.x * delta.x + direction.y * delta.y + direction.z * delta.z;

            if (toW > fromW) {
                const fromVoxelW = Math.ceil(fromW);
                const toVoxelW = Math.floor(toW);
                for (let voxelW = fromVoxelW; voxelW <= toVoxelW; voxelW++) {
                    const progress = (voxelW - fromW) / deltaW;
                    coords.copy(from).addScaledVector(delta, progress);
                    candidates.push({
                        distance: maxDistance * progress,
                        voxelId: {
                            x: direction.x > 0 ? voxelW : Math.floor(coords.x),
                            y: direction.y > 0 ? voxelW : Math.floor(coords.y),
                            z: direction.z > 0 ? voxelW : Math.floor(coords.z),
                        },
                    });
                }
            } else if (toW < fromW) {
                const fromVoxelW = Math.floor(fromW);
                const toVoxelW = Math.ceil(toW);
                for (let voxelW = fromVoxelW; voxelW >= toVoxelW; voxelW--) {
                    const progress = (voxelW - fromW) / deltaW;
                    coords.copy(from).addScaledVector(delta, progress);
                    candidates.push({
                        distance: maxDistance * progress,
                        voxelId: {
                            x: (direction.x > 0 ? voxelW : Math.floor(coords.x)) - direction.x,
                            y: (direction.y > 0 ? voxelW : Math.floor(coords.y)) - direction.y,
                            z: (direction.z > 0 ? voxelW : Math.floor(coords.z)) - direction.z,
                        },
                    });
                }
            }
        };
        addCandidates({ x: 1, y: 0, z: 0 });
        addCandidates({ x: 0, y: 1, z: 0 });
        addCandidates({ x: 0, y: 0, z: 1 });
        candidates.sort((a: Candidate, b: Candidate) => a.distance - b.distance);

        for (const candidate of candidates) {
            if (this.voxelmapCollider.getVoxel(candidate.voxelId) === EVoxelStatus.FULL) {
                return {
                    distance: candidate.distance,
                    point: new THREE.Vector3().copy(from).addScaledVector(direction, candidate.distance),
                };
            }
        }

        return null;
    }

    public sphereIntersect(sphere: THREE.Sphere): SphereIntersection | null {
        const displacements: THREE.Vector3Like[] = [];
        const addDisplacementIfNeeded = (sphereCenterProjection: THREE.Vector3Like) => {
            const projectionToCenter = new THREE.Vector3().subVectors(sphere.center, sphereCenterProjection);
            const distanceFromCenter = projectionToCenter.length();
            if (distanceFromCenter < sphere.radius) {
                displacements.push(projectionToCenter.normalize().multiplyScalar(sphere.radius - distanceFromCenter));
            }
        };

        const voxelFrom = sphere.center.clone().subScalar(sphere.radius).floor();
        const voxelTo = sphere.center.clone().addScalar(sphere.radius).floor();

        const voxel = { x: 0, y: 0, z: 0 };
        for (voxel.z = voxelFrom.z; voxel.z <= voxelTo.z; voxel.z++) {
            for (voxel.y = voxelFrom.y; voxel.y <= voxelTo.y; voxel.y++) {
                for (voxel.x = voxelFrom.x; voxel.x <= voxelTo.x; voxel.x++) {
                    const localSphereCenter: THREE.Vector3Like = new THREE.Vector3().subVectors(sphere.center, voxel);
                    const sphereCenterLocalProjection2dX = this.pointSquareProjection({ x: localSphereCenter.z, y: localSphereCenter.y });
                    const sphereCenterLocalProjection2dY = this.pointSquareProjection({ x: localSphereCenter.x, y: localSphereCenter.z });
                    const sphereCenterLocalProjection2dZ = this.pointSquareProjection({ x: localSphereCenter.x, y: localSphereCenter.y });

                    const sphereCenterProjection2dX = { x: sphereCenterLocalProjection2dX.x + voxel.z, y: sphereCenterLocalProjection2dX.y + voxel.y };
                    const sphereCenterProjection2dY = { x: sphereCenterLocalProjection2dY.x + voxel.x, y: sphereCenterLocalProjection2dY.y + voxel.z };
                    const sphereCenterProjection2dZ = { x: sphereCenterLocalProjection2dZ.x + voxel.x, y: sphereCenterLocalProjection2dZ.y + voxel.y };

                    const voxelIsFull = this.voxelmapCollider.getVoxel(voxel) !== EVoxelStatus.EMPTY;

                    const voxelBelowIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y - 1, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelAboveIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y + 1, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelLeftIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x - 1, y: voxel.y, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelRightIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x + 1, y: voxel.y, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelBackIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y, z: voxel.z - 1 }) !== EVoxelStatus.EMPTY;
                    const voxelFrontIsFull = this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y, z: voxel.z + 1 }) !== EVoxelStatus.EMPTY;

                    if (voxelIsFull !== voxelBelowIsFull) {
                        addDisplacementIfNeeded({ x: sphereCenterProjection2dY.x, y: voxel.y, z: sphereCenterProjection2dY.y });
                    }
                    if (voxelIsFull !== voxelAboveIsFull) {
                        addDisplacementIfNeeded({ x: sphereCenterProjection2dY.x, y: voxel.y + 1, z: sphereCenterProjection2dY.y });
                    }
                    if (voxelIsFull !== voxelLeftIsFull) {
                        addDisplacementIfNeeded({ x: voxel.x, y: sphereCenterProjection2dX.y, z: sphereCenterProjection2dX.x });
                    }
                    if (voxelIsFull !== voxelRightIsFull) {
                        addDisplacementIfNeeded({ x: voxel.x + 1, y: sphereCenterProjection2dX.y, z: sphereCenterProjection2dX.x });
                    }
                    if (voxelIsFull !== voxelBackIsFull) {
                        addDisplacementIfNeeded({ x: sphereCenterProjection2dZ.x, y: sphereCenterProjection2dZ.y, z: voxel.z });
                    }
                    if (voxelIsFull !== voxelFrontIsFull) {
                        addDisplacementIfNeeded({ x: sphereCenterProjection2dZ.x, y: sphereCenterProjection2dZ.y, z: voxel.z + 1 });
                    }
                }
            }
        }

        if (displacements.length > 0) {
            const totalDisplacement = new THREE.Vector3();
            for (const displacement of displacements) {
                totalDisplacement.add(displacement);
            }
            totalDisplacement.divideScalar(displacements.length);
            const totalDepth = totalDisplacement.length();
            return {
                normal: totalDisplacement.normalize(),
                depth: totalDepth,
            };
        }

        return null;
    }

    /* Computes the projection of a point onto the {0,1}² square. */
    private pointSquareProjection(point: THREE.Vector2Like): THREE.Vector2 {
        return new THREE.Vector2(
            clamp(point.x, 0, 1),
            clamp(point.y, 0, 1),
        );
    }
}

export { VoxelmapCollisions };
