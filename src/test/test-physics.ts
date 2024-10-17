import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import {
    EComputationMethod,
    EVoxelStatus,
    type IVoxelMap,
    PromisesQueue,
    VoxelmapCollider,
    VoxelmapCollisions,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    type VoxelsChunkOrdering,
} from '../lib';

import { TestBase } from './test-base';

type SolidSphere = {
    readonly mesh: THREE.Mesh;
    readonly collider: THREE.Sphere;
    readonly velocity: THREE.Vector3;
};

class TestPhysics extends TestBase {
    private readonly map: IVoxelMap;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly voxelmapCollider: VoxelmapCollider;
    private readonly voxelmapCollisions: VoxelmapCollisions;

    private readonly ray: {
        readonly group: THREE.Object3D;
        readonly mesh: THREE.Mesh;
        readonly intersectionMesh: THREE.Mesh;
    };

    private readonly spheres: SolidSphere[] = [];

    private readonly player: {
        readonly size: {
            readonly radius: number;
            readonly height: number;
        };

        readonly container: THREE.Object3D;
        readonly velocity: THREE.Vector3;
        touchesFloor: boolean;
    };

    private lastUpdate: number | null = null;

    private readonly keyDown = new Map<string, boolean>();

    public constructor(map: IVoxelMap) {
        super();

        const gui = new GUI();
        gui.add(this, 'maxFps', 1, 120, 1);

        this.camera.position.set(-10, 170, 0);
        this.cameraControl.target.set(0, 150, 0);

        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 100);
        this.scene.add(dirLight);

        this.map = map;

        const chunkSize = { xz: 64, y: 64 };
        const minChunkIdY = Math.floor(map.minAltitude / chunkSize.y);
        const maxChunkIdY = Math.floor(map.maxAltitude / chunkSize.y);

        const voxelsChunkOrdering: VoxelsChunkOrdering = 'zyx';

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, map.voxelMaterialsList, {
            patchSize: chunkSize,
            computationOptions: {
                method: EComputationMethod.CPU_MULTITHREADED,
                threadsCount: 4,
                greedyMeshing: true,
            },
            checkerboardType: 'xz',
            voxelsChunkOrdering,
        });

        this.scene.add(this.voxelmapViewer.container);
        this.promisesQueue = new PromisesQueue(this.voxelmapViewer.maxPatchesComputedInParallel + 5);

        this.voxelmapCollider = new VoxelmapCollider({
            chunkSize: { x: chunkSize.xz, y: chunkSize.y, z: chunkSize.xz },
            voxelsChunkOrdering,
        });
        this.voxelmapCollisions = new VoxelmapCollisions({ voxelmapCollider: this.voxelmapCollider });

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(
            { x: chunkSize.xz, y: chunkSize.y, z: chunkSize.xz },
            minChunkIdY,
            maxChunkIdY
        );
        this.voxelmapVisibilityComputer.showMapAroundPosition({ x: 0, y: 0, z: 0 }, 200);

        this.displayMap();

        const rayGroup = new THREE.Group();
        rayGroup.position.set(0, 170, 0);
        rayGroup.rotateX(0.7 * Math.PI);
        this.scene.add(rayGroup);

        const rayMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        rayMesh.position.set(0, 0.5, 0);
        rayGroup.add(rayMesh);
        const rayIntersectionMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
        );
        rayIntersectionMesh.position.set(0, 1, 0);
        rayGroup.add(rayIntersectionMesh);

        this.ray = {
            group: rayGroup,
            mesh: rayMesh,
            intersectionMesh: rayIntersectionMesh,
        };
        const rayControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        rayControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        rayControls.mode = 'rotate';
        rayControls.attach(rayGroup);
        this.scene.add(rayControls);

        this.setRayLength(10);

        const playerSize = {
            radius: 0.2,
            height: 1.5,
        };
        const playerMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(playerSize.radius, playerSize.radius, playerSize.height),
            new THREE.MeshPhongMaterial({ color: 0xdddddd })
        );
        const playerContainer = new THREE.Group();
        playerContainer.add(playerMesh);
        playerMesh.position.y = playerSize.height / 2;
        playerContainer.position.y = 160;

        this.player = {
            size: playerSize,
            container: playerContainer,
            velocity: new THREE.Vector3(0, 0, 0),
            touchesFloor: false,
        };
        this.scene.add(this.player.container);

        const sphereRadius = 1.1;
        const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius), new THREE.MeshPhongMaterial({ color: 0xdddddd }));

        window.addEventListener('keyup', event => {
            if (event.code === 'Space') {
                const direction = this.camera.getWorldDirection(new THREE.Vector3());
                const position = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, 2);
                const mesh = sphereMesh.clone();
                mesh.position.copy(position);
                const collider = new THREE.Sphere(position, sphereRadius);
                const velocity = new THREE.Vector3().addScaledVector(direction, 80);

                const solidSphere: SolidSphere = { mesh, collider, velocity };
                this.scene.add(solidSphere.mesh);
                this.spheres.push(solidSphere);
            }

            this.keyDown.set(event.code, false);
        });
        window.addEventListener('keydown', event => {
            this.keyDown.set(event.code, true);
        });
    }

    protected override update(): void {
        this.updateRay();
        this.updateSpheresAndPlayer();
    }

    private updateRay(): void {
        const maxDistance = 500;
        const rayFrom = this.ray.group.getWorldPosition(new THREE.Vector3());
        const rayDirection = new THREE.Vector3(0, 1, 0).transformDirection(this.ray.group.matrixWorld);
        const rayTo = rayFrom.clone().addScaledVector(rayDirection, maxDistance);
        const intersection = this.voxelmapCollisions.rayCast(rayFrom, rayTo);
        const intersectionDistance = intersection?.distance ?? maxDistance;
        this.setRayLength(intersectionDistance);
    }

    private updateSpheresAndPlayer(): void {
        const now = performance.now();
        const lastUpdate = this.lastUpdate ?? now;
        const deltaTime = (now - lastUpdate) / 1000;
        this.lastUpdate = now;

        const maxDeltaTime = 10 / 1000;
        let remainingDeltaTime = deltaTime;
        while (remainingDeltaTime > 0) {
            const localDeltaTime = Math.min(remainingDeltaTime, maxDeltaTime);
            this.updateSpheres(localDeltaTime);
            this.updatePlayer(localDeltaTime);
            remainingDeltaTime -= localDeltaTime;
        }
    }

    private updateSpheres(deltaTime: number): void {
        const gravity = 80;

        for (const sphere of this.spheres) {
            sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);
            sphere.mesh.position.copy(sphere.collider.center);

            const result = this.voxelmapCollisions.sphereIntersect(sphere.collider);
            if (result) {
                sphere.velocity.addScaledVector(result.normal, -result.normal.dot(sphere.velocity) * 1.5);
                sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
            } else {
                sphere.velocity.y -= gravity * deltaTime;
            }

            const damping = Math.exp(-0.5 * deltaTime) - 1;
            sphere.velocity.addScaledVector(sphere.velocity, damping);
        }
    }

    private updatePlayer(deltaTime: number): void {
        const gravity = 20;
        const movementSpeed = 10;
        const ascendSpeed = 10;

        const playerPosition = this.player.container.position;
        const playerVelocity = this.player.velocity;
        const previousPosition = playerPosition.clone();

        const fromX = Math.floor(playerPosition.x - this.player.size.radius);
        const toX = Math.floor(playerPosition.x + this.player.size.radius);
        const fromZ = Math.floor(playerPosition.z - this.player.size.radius);
        const toZ = Math.floor(playerPosition.z + this.player.size.radius);

        playerPosition.addScaledVector(playerVelocity, deltaTime);

        const isXZRelevant = (voxelX: number, voxelZ: number) => {
            const projection = {
                x: THREE.clamp(playerPosition.x, voxelX, voxelX + 1),
                z: THREE.clamp(playerPosition.z, voxelZ, voxelZ + 1),
            };
            const toCenter = {
                x: projection.x - playerPosition.x,
                z: projection.z - playerPosition.z,
            };
            const distance = Math.sqrt(toCenter.x ** 2 + toCenter.z ** 2);
            return distance < this.player.size.radius;
        };

        const isLevelFree = (y: number) => {
            for (let iX = fromX; iX <= toX; iX++) {
                for (let iZ = fromZ; iZ <= toZ; iZ++) {
                    if (isXZRelevant(iX, iZ)) {
                        if (this.voxelmapCollider.getVoxel({ x: iX, y, z: iZ }) !== EVoxelStatus.EMPTY) {
                            return false;
                        }
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

        const levelBelow = Number.isInteger(playerPosition.y) ? playerPosition.y - 1 : Math.floor(playerPosition.y);
        const belowIsEmpty = isLevelFree(levelBelow);
        if (belowIsEmpty) {
            playerVelocity.y = -gravity;
        } else {
            playerVelocity.y = 0;

            let isAscending = false;
            const currentLevel = Math.floor(playerPosition.y);
            if (!isLevelFree(currentLevel)) {
                // we are partially in the map

                let aboveLevelsAreFree = true;
                const aboveLevelsFrom = currentLevel + 1;
                const aboveLevelsTo = Math.floor(aboveLevelsFrom + this.player.size.height);
                for (let iY = aboveLevelsFrom; iY <= aboveLevelsTo; iY++) {
                    if (!isLevelFree(iY)) {
                        aboveLevelsAreFree = false;
                        break;
                    }
                }

                if (aboveLevelsAreFree) {
                    isAscending = true;
                }
            }

            if (isAscending) {
                playerVelocity.y = ascendSpeed;
            } else {
                // TODO compute lateral collisions
            }
        }

        this.player.touchesFloor = true;
        if (this.player.touchesFloor) {
            let isMoving = false;
            const directiond2d = new THREE.Vector2(0, 0);
            if (this.keyDown.get('KeyW')) {
                isMoving = true;
                directiond2d.y++;
            }
            if (this.keyDown.get('KeyS')) {
                isMoving = true;
                directiond2d.y--;
            }
            if (this.keyDown.get('KeyA')) {
                isMoving = true;
                directiond2d.x--;
            }
            if (this.keyDown.get('KeyD')) {
                isMoving = true;
                directiond2d.x++;
            }

            if (isMoving) {
                const cameraFront = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
                const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();

                directiond2d.normalize().multiplyScalar(movementSpeed * deltaTime);
                this.player.container.position.addScaledVector(cameraRight, directiond2d.x).addScaledVector(cameraFront, directiond2d.y);
            }
        }
    }

    private async displayMap(): Promise<void> {
        const patchesToDisplay = this.voxelmapVisibilityComputer.getRequestedPatches();
        const patchesIdToDisplay = patchesToDisplay.map(patchToDisplay => patchToDisplay.id);

        this.voxelmapViewer.setVisibility(patchesIdToDisplay);

        this.promisesQueue.cancelAll();
        for (const patchId of patchesIdToDisplay) {
            if (this.voxelmapViewer.doesPatchRequireVoxelsData(patchId)) {
                this.promisesQueue.run(
                    async () => {
                        if (this.voxelmapViewer.doesPatchRequireVoxelsData(patchId)) {
                            const voxelsChunkBox = this.voxelmapViewer.getPatchVoxelsBox(patchId);
                            const blockStart = voxelsChunkBox.min;
                            const blockEnd = voxelsChunkBox.max;

                            const patchMapData = await this.map.getLocalMapData(blockStart, blockEnd);
                            const voxelsChunkData = Object.assign(patchMapData, {
                                size: new THREE.Vector3().subVectors(blockEnd, blockStart),
                            });
                            this.voxelmapCollider.setChunk(patchId, patchMapData);
                            await this.voxelmapViewer.enqueuePatch(patchId, voxelsChunkData);
                        }
                    },
                    () => {
                        this.voxelmapViewer.dequeuePatch(patchId);
                    }
                );
            }
        }
    }

    private setRayLength(length: number): void {
        this.ray.mesh.position.set(0, 0.5 * length, 0);
        this.ray.mesh.scale.set(1, length, 1);
        this.ray.intersectionMesh.position.set(0, length, 0);
    }
}

export { TestPhysics };
