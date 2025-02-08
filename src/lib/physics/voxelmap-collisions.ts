import { EVoxelStatus } from '..';
import { clamp } from '../helpers/math';
import * as THREE from '../libs/three-usage';

import { type IVoxelmapCollider } from './i-voxelmap-collider';

type Parameters = {
    readonly voxelmapCollider: IVoxelmapCollider;
};

type ComputationStatus = 'ok' | 'partial';

type FaceSide = typeof THREE.FrontSide | typeof THREE.BackSide | typeof THREE.DoubleSide;

type RaycastOptions = {
    readonly maxDistance: number;
    readonly side: FaceSide;
    readonly missingVoxels: {
        readonly considerAsBlocking: boolean;
        readonly exportAsList: boolean;
    };
};

type RaycastOutput = {
    computationStatus: ComputationStatus;
    intersection?: {
        distance: number;
        point: THREE.Vector3Like;
        normal: THREE.Vector3Like;
    };
    missingVoxels?: THREE.Vector3Like[];
};

type SphereIntersection = {
    readonly normal: THREE.Vector3;
    readonly depth: number;
};

type EntityCollider = {
    readonly radius: number;
    readonly height: number;
    readonly position: THREE.Vector3Like;
    readonly velocity: THREE.Vector3Like;
};

type EntityCollisionOptions = {
    readonly deltaTime: number;
    readonly gravity: number;
    readonly ascendSpeed: number;
    readonly missingVoxels: {
        readonly considerAsBlocking: boolean;
        readonly exportAsList: boolean;
    };
};

type EntityCollisionOutput = {
    computationStatus: ComputationStatus;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    isOnGround: boolean;
    missingVoxels?: THREE.Vector3Like[];
};

function removeVoxelIdDuplicates(list: Iterable<THREE.Vector3Like>): THREE.Vector3Like[] {
    const map = new Map<string, THREE.Vector3Like>();
    for (const voxelId of list) {
        map.set(`${voxelId.x}_${voxelId.y}_${voxelId.z}`, voxelId);
    }
    return Array.from(map.values());
}

class VoxelmapCollisions {
    private readonly voxelmapCollider: IVoxelmapCollider;

    public constructor(params: Parameters) {
        this.voxelmapCollider = params.voxelmapCollider;
    }

    public getVoxelStatus(point: THREE.Vector3Like): EVoxelStatus {
        return this.voxelmapCollider.getVoxel({
            x: Math.floor(point.x),
            y: Math.floor(point.y),
            z: Math.floor(point.z),
        });
    }

    public rayIntersect(ray: THREE.Ray, options: RaycastOptions): RaycastOutput | null {
        if (options.maxDistance <= 0) {
            return null;
        }

        type Candidate = {
            readonly distance: number;
            readonly voxelId1: THREE.Vector3Like;
            readonly voxelId2: THREE.Vector3Like;
            readonly direction: THREE.Vector3Like;
        };

        const from = ray.origin;
        const delta = ray.direction.clone().multiplyScalar(options.maxDistance);
        const to = new THREE.Vector3().addVectors(ray.origin, delta);

        const coords = new THREE.Vector3();
        const candidates: Candidate[] = [];
        const addCandidates = (direction: THREE.Vector3Like): void => {
            const fromW = ray.origin.dot(direction);
            const toW = to.dot(direction);
            const deltaW = toW - fromW;

            const fromVoxelW = Math.floor(fromW);
            const toVoxelW = Math.floor(toW);

            if (deltaW > 0) {
                for (let voxelW = fromVoxelW; voxelW <= toVoxelW; voxelW++) {
                    const progress = (voxelW + 1 - fromW) / deltaW;
                    coords.copy(from).addScaledVector(delta, progress).floor();
                    candidates.push({
                        distance: options.maxDistance * progress,
                        voxelId1: {
                            x: direction.x === 0 ? coords.x : voxelW,
                            y: direction.y === 0 ? coords.y : voxelW,
                            z: direction.z === 0 ? coords.z : voxelW,
                        },
                        voxelId2: {
                            x: direction.x === 0 ? coords.x : voxelW + 1,
                            y: direction.y === 0 ? coords.y : voxelW + 1,
                            z: direction.z === 0 ? coords.z : voxelW + 1,
                        },
                        direction: { ...direction },
                    });
                }
            } else if (deltaW < 0) {
                for (let voxelW = fromVoxelW; voxelW >= toVoxelW; voxelW--) {
                    const progress = (voxelW - fromW) / deltaW;
                    coords.copy(from).addScaledVector(delta, progress).floor();
                    candidates.push({
                        distance: options.maxDistance * progress,
                        voxelId1: {
                            x: direction.x === 0 ? coords.x : voxelW,
                            y: direction.y === 0 ? coords.y : voxelW,
                            z: direction.z === 0 ? coords.z : voxelW,
                        },
                        voxelId2: {
                            x: direction.x === 0 ? coords.x : voxelW - 1,
                            y: direction.y === 0 ? coords.y : voxelW - 1,
                            z: direction.z === 0 ? coords.z : voxelW - 1,
                        },
                        direction: { ...direction },
                    });
                }
            }
        };
        addCandidates({ x: 1, y: 0, z: 0 });
        addCandidates({ x: 0, y: 1, z: 0 });
        addCandidates({ x: 0, y: 0, z: 1 });
        candidates.sort((a: Candidate, b: Candidate) => a.distance - b.distance);

        const missingVoxels: THREE.Vector3Like[] | null = options.missingVoxels.exportAsList ? [] : null;

        let computationStatus: ComputationStatus = 'ok';
        const isVoxelFull = (voxelId: THREE.Vector3Like) => {
            const voxelStatus = this.voxelmapCollider.getVoxel(voxelId);
            if (voxelStatus === EVoxelStatus.NOT_LOADED) {
                computationStatus = 'partial';
                if (missingVoxels) {
                    missingVoxels.push({ ...voxelId });
                }
                return options.missingVoxels.considerAsBlocking;
            }
            return voxelStatus === EVoxelStatus.FULL;
        };

        let result: RaycastOutput | null = null;

        for (const candidate of candidates) {
            const isVoxel1Full = isVoxelFull(candidate.voxelId1);
            const isVoxel2Full = isVoxelFull(candidate.voxelId2);

            if (isVoxel1Full !== isVoxel2Full) {
                if (isVoxel1Full) {
                    if (options.side === THREE.BackSide || options.side === THREE.DoubleSide) {
                        result = {
                            computationStatus,
                            intersection: {
                                distance: candidate.distance,
                                point: ray.origin.clone().addScaledVector(ray.direction, candidate.distance),
                                normal: new THREE.Vector3().copy(candidate.direction),
                            },
                        };
                        break;
                    }
                } else {
                    if (options.side === THREE.FrontSide || options.side === THREE.DoubleSide) {
                        result = {
                            computationStatus,
                            intersection: {
                                distance: candidate.distance,
                                point: ray.origin.clone().addScaledVector(ray.direction, candidate.distance),
                                normal: new THREE.Vector3().copy(candidate.direction).multiplyScalar(-1),
                            },
                        };
                        break;
                    }
                }
            }
        }

        if (!result) {
            result = {
                computationStatus,
            };
        }
        if (missingVoxels) {
            result.missingVoxels = removeVoxelIdDuplicates(missingVoxels);
        }

        return result;
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

                    const sphereCenterProjection2dX = {
                        x: sphereCenterLocalProjection2dX.x + voxel.z,
                        y: sphereCenterLocalProjection2dX.y + voxel.y,
                    };
                    const sphereCenterProjection2dY = {
                        x: sphereCenterLocalProjection2dY.x + voxel.x,
                        y: sphereCenterLocalProjection2dY.y + voxel.z,
                    };
                    const sphereCenterProjection2dZ = {
                        x: sphereCenterLocalProjection2dZ.x + voxel.x,
                        y: sphereCenterLocalProjection2dZ.y + voxel.y,
                    };

                    const voxelIsFull = this.voxelmapCollider.getVoxel(voxel) !== EVoxelStatus.EMPTY;

                    const voxelBelowIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y - 1, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelAboveIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y + 1, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelLeftIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x - 1, y: voxel.y, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelRightIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x + 1, y: voxel.y, z: voxel.z }) !== EVoxelStatus.EMPTY;
                    const voxelBackIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y, z: voxel.z - 1 }) !== EVoxelStatus.EMPTY;
                    const voxelFrontIsFull =
                        this.voxelmapCollider.getVoxel({ x: voxel.x, y: voxel.y, z: voxel.z + 1 }) !== EVoxelStatus.EMPTY;

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

    public entityMovement(entityCollider: EntityCollider, options: EntityCollisionOptions): EntityCollisionOutput {
        const maxDeltaTime = 10 / 1000;

        const missingVoxels: THREE.Vector3Like[] | null = options.missingVoxels.exportAsList ? [] : null;

        let currentState = entityCollider;
        const output: EntityCollisionOutput = {
            computationStatus: 'ok',
            position: new THREE.Vector3().copy(entityCollider.position),
            velocity: new THREE.Vector3().copy(entityCollider.velocity),
            isOnGround: false,
        };

        const applyAndMergeStep = (deltaTime: number) => {
            const localOutput = this.entityMovementInternal(currentState, {
                ...options,
                deltaTime,
            });

            currentState = {
                radius: currentState.radius,
                height: currentState.height,
                position: localOutput.position,
                velocity: localOutput.velocity,
            };

            if (localOutput.computationStatus === 'partial') {
                output.computationStatus = 'partial';
            }
            output.position = localOutput.position;
            output.velocity = localOutput.velocity;
            output.isOnGround = localOutput.isOnGround;

            if (missingVoxels && localOutput.missingVoxels) {
                missingVoxels.push(...localOutput.missingVoxels);
            }
        };

        let remainingDeltaTime = options.deltaTime;
        while (remainingDeltaTime > 0) {
            const localDeltaTime = Math.min(remainingDeltaTime, maxDeltaTime);
            remainingDeltaTime -= localDeltaTime;
            applyAndMergeStep(localDeltaTime);
        }

        for (let i = 0; i < 3; i++) {
            applyAndMergeStep(0);
            applyAndMergeStep(0);
        }

        if (missingVoxels) {
            output.missingVoxels = removeVoxelIdDuplicates(missingVoxels);
        }
        return output;
    }

    private entityMovementInternal(entityCollider: EntityCollider, options: EntityCollisionOptions): EntityCollisionOutput {
        const epsilon = 1e-5;

        let allVoxelmapDataIsAvailable = true;

        const { deltaTime, gravity } = options;
        if (gravity < 0) {
            throw new Error(`Invert gravity not supported.`);
        }

        const missingVoxels: THREE.Vector3Like[] | null = options.missingVoxels.exportAsList ? [] : null;

        const playerPosition = new THREE.Vector3().copy(entityCollider.position);
        const playerVelocity = new THREE.Vector3().copy(entityCollider.velocity);
        const playerRadius = entityCollider.radius;
        const playerRadiusSquared = playerRadius * playerRadius;
        const playerHeight = entityCollider.height;
        const previousPosition = playerPosition.clone();

        const fromX = Math.floor(playerPosition.x - playerRadius);
        const toX = Math.floor(playerPosition.x + playerRadius);
        const fromZ = Math.floor(playerPosition.z - playerRadius);
        const toZ = Math.floor(playerPosition.z + playerRadius);

        playerPosition.addScaledVector(playerVelocity, deltaTime);

        const closetPointFromVoxel = (voxelX: number, voxelZ: number) => {
            const projection = {
                x: clamp(playerPosition.x, voxelX, voxelX + 1),
                z: clamp(playerPosition.z, voxelZ, voxelZ + 1),
            };
            return {
                x: projection.x - playerPosition.x,
                z: projection.z - playerPosition.z,
            };
        };

        const isXZRelevant = (voxelX: number, voxelZ: number) => {
            const fromVoxel = closetPointFromVoxel(voxelX, voxelZ);
            const distanceSquared = fromVoxel.x ** 2 + fromVoxel.z ** 2;
            return distanceSquared < playerRadiusSquared;
        };

        const isVoxelFull = (voxel: THREE.Vector3Like) => {
            const voxelStatus = this.voxelmapCollider.getVoxel(voxel);
            if (voxelStatus === EVoxelStatus.NOT_LOADED) {
                allVoxelmapDataIsAvailable = false;
                if (missingVoxels) {
                    missingVoxels.push({ ...voxel });
                }
                return options.missingVoxels.considerAsBlocking;
            }
            return voxelStatus === EVoxelStatus.FULL;
        };

        const isLevelFree = (y: number) => {
            for (let iX = fromX; iX <= toX; iX++) {
                for (let iZ = fromZ; iZ <= toZ; iZ++) {
                    if (isXZRelevant(iX, iZ) && isVoxelFull({ x: iX, y, z: iZ })) {
                        return false;
                    }
                }
            }
            return true;
        };

        const previousLevel = Math.floor(previousPosition.y);
        const newLevel = Math.floor(playerPosition.y);

        if (newLevel < previousLevel && !isLevelFree(previousLevel - 1)) {
            // we just entered the ground -> rollback
            playerVelocity.y = 0;
            playerPosition.y = previousLevel;
        }

        let isOnGround = false;

        const levelBelow = Number.isInteger(playerPosition.y) ? playerPosition.y - 1 : Math.floor(playerPosition.y);
        const belowIsEmpty = isLevelFree(levelBelow);
        if (belowIsEmpty) {
            playerVelocity.y -= gravity * deltaTime;
            playerVelocity.y = Math.max(-gravity, playerVelocity.y);
        } else {
            isOnGround = Number.isInteger(playerPosition.y);

            let isAscending = false;
            const currentLevel = Math.floor(playerPosition.y);
            if (!isLevelFree(currentLevel)) {
                // we are partially in the map
                let aboveLevelsAreFree = true;
                const aboveLevelsFrom = currentLevel + 1;
                const aboveLevelsTo = Math.floor(aboveLevelsFrom + playerHeight);
                for (let iY = aboveLevelsFrom; iY <= aboveLevelsTo && aboveLevelsAreFree; iY++) {
                    if (!isLevelFree(iY)) {
                        aboveLevelsAreFree = false;
                    }
                }

                if (aboveLevelsAreFree) {
                    isAscending = true;
                }
            }

            if (isAscending) {
                const upwardsMovement = options.ascendSpeed * options.deltaTime;
                const boundary = Number.isInteger(playerPosition.y) ? playerPosition.y + 1 : Math.ceil(playerPosition.y);
                playerPosition.y = Math.min(boundary, playerPosition.y + upwardsMovement);
            } else {
                const displacements: THREE.Vector3Like[] = [];

                type XZ = { readonly x: number; readonly z: number };
                const addDisplacement = (normal: XZ, projection: XZ) => {
                    const fromCenter = { x: projection.x - playerPosition.x, z: projection.z - playerPosition.z };
                    const distanceSquared = fromCenter.x ** 2 + fromCenter.z ** 2;
                    if (distanceSquared < playerRadiusSquared) {
                        const distance = Math.sqrt(distanceSquared);
                        if (fromCenter.x * normal.x + fromCenter.z * normal.z < 0) {
                            const depth = playerRadius - distance + epsilon;

                            displacements.push({
                                x: normal.x * depth,
                                y: 0,
                                z: normal.z * depth,
                            });
                        }
                    }
                };

                const levelFrom = Math.floor(playerPosition.y);
                const levelTo = Math.floor(playerPosition.y + playerHeight);
                const voxel = { x: 0, y: 0, z: 0 };
                for (voxel.y = levelFrom; voxel.y <= levelTo; voxel.y++) {
                    for (voxel.x = fromX; voxel.x <= toX; voxel.x++) {
                        for (voxel.z = fromZ; voxel.z <= toZ; voxel.z++) {
                            const isFull = isVoxelFull(voxel);
                            const isLeftFull = isVoxelFull({ x: voxel.x - 1, y: voxel.y, z: voxel.z });
                            const isRightFull = isVoxelFull({ x: voxel.x + 1, y: voxel.y, z: voxel.z });
                            const isBackFull = isVoxelFull({ x: voxel.x, y: voxel.y, z: voxel.z - 1 });
                            const isFrontFull = isVoxelFull({ x: voxel.x, y: voxel.y, z: voxel.z + 1 });

                            if (isFull) {
                                if (!isLeftFull) {
                                    const normal = { x: -1, z: 0 };
                                    const projection = { x: voxel.x, z: clamp(playerPosition.z, voxel.z, voxel.z + 1) };
                                    addDisplacement(normal, projection);
                                }
                                if (!isRightFull) {
                                    const normal = { x: 1, z: 0 };
                                    const projection = { x: voxel.x + 1, z: clamp(playerPosition.z, voxel.z, voxel.z + 1) };
                                    addDisplacement(normal, projection);
                                }
                                if (!isBackFull) {
                                    const normal = { x: 0, z: -1 };
                                    const projection = { x: clamp(playerPosition.x, voxel.x, voxel.x + 1), z: voxel.z };
                                    addDisplacement(normal, projection);
                                }
                                if (!isFrontFull) {
                                    const normal = { x: 0, z: 1 };
                                    const projection = { x: clamp(playerPosition.x, voxel.x, voxel.x + 1), z: voxel.z + 1 };
                                    addDisplacement(normal, projection);
                                }
                            }
                        }
                    }
                }

                if (displacements.length > 0) {
                    const averageDisplacement = new THREE.Vector3();
                    for (const displacement of displacements) {
                        averageDisplacement.add(displacement);
                    }
                    averageDisplacement.divideScalar(displacements.length);
                    playerPosition.add(averageDisplacement);

                    if (averageDisplacement.x !== 0) {
                        playerVelocity.x = 0;
                    }
                    if (averageDisplacement.z !== 0) {
                        playerVelocity.z = 0;
                    }
                }
            }
        }

        const result: EntityCollisionOutput = {
            computationStatus: allVoxelmapDataIsAvailable ? 'ok' : 'partial',
            position: playerPosition,
            velocity: playerVelocity,
            isOnGround,
        };
        if (missingVoxels) {
            result.missingVoxels = missingVoxels;
        }
        return result;
    }

    /* Computes the projection of a point onto the {0,1}² square. */
    private pointSquareProjection(point: THREE.Vector2Like): THREE.Vector2 {
        return new THREE.Vector2(clamp(point.x, 0, 1), clamp(point.y, 0, 1));
    }
}

export { VoxelmapCollisions };
