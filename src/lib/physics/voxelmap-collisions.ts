import * as THREE from '../libs/three-usage';

import { EVoxelStatus, type VoxelmapCollider } from './voxelmap-collider';

type Parameters = {
    readonly voxelmapCollider: VoxelmapCollider;
};

type RayIntersection = {
    readonly distance: number;
    readonly point: THREE.Vector3Like;
};

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
}

export { VoxelmapCollisions };
