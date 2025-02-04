import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import {
    EComputationMethod,
    type IVoxelMap,
    MaterialsStore,
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
    };

    private lastUpdate: number | null = null;

    private readonly keyDown = new Map<string, boolean>();
    private readonly keysPressed: Set<string> = new Set();

    public constructor(map: IVoxelMap) {
        super();

        const gui = new GUI();
        gui.add(this, 'maxFps' as keyof TestBase, 1, 120, 1);

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

        const voxelMaterialsStore = new MaterialsStore({
            voxelMaterialsList: map.voxelMaterialsList,
            maxShininess: 400,
        });

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, voxelMaterialsStore, {
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
        this.scene.add(rayControls.getHelper());

        this.setRayLength(10);

        const playerSize = {
            radius: 0.2,
            height: 1.4,
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
        };
        this.scene.add(this.player.container);

        const sphereRadius = 1.1;
        const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius), new THREE.MeshPhongMaterial({ color: 0xdddddd }));

        window.addEventListener('keyup', event => {
            if (event.code === 'KeyP') {
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
            this.keysPressed.add(event.code);
        });
        window.addEventListener('keydown', event => {
            this.keyDown.set(event.code, true);
        });
    }

    protected override update(): void {
        for (const [keyCode, isPressed] of this.keyDown.entries()) {
            if (isPressed && keyCode !== 'Space') {
                this.keysPressed.add(keyCode);
            }
        }

        this.updateRay();
        this.updateSpheresAndPlayer();
    }

    private updateRay(): void {
        const maxDistance = 500;
        const ray = new THREE.Ray(
            this.ray.group.getWorldPosition(new THREE.Vector3()),
            new THREE.Vector3(0, 1, 0).transformDirection(this.ray.group.matrixWorld)
        );
        const intersectionResult = this.voxelmapCollisions.rayIntersect(ray, {
            maxDistance,
            side: THREE.DoubleSide,
            missingVoxels: {
                considerAsBlocking: false,
                exportAsList: true,
            },
        });
        const intersectionDistance = intersectionResult?.intersection?.distance ?? maxDistance;
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
            remainingDeltaTime -= localDeltaTime;
        }
        this.updatePlayer(deltaTime);
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
        const entityCollisionOutput = this.voxelmapCollisions.entityMovement(
            {
                radius: this.player.size.radius,
                height: this.player.size.height,
                position: this.player.container.position,
                velocity: this.player.velocity,
            },
            {
                deltaTime,
                gravity: 250,
                ascendSpeed: 30,
                missingVoxels: {
                    considerAsBlocking: true,
                    exportAsList: true,
                },
            }
        );

        this.player.container.position.copy(entityCollisionOutput.position);
        this.player.velocity.copy(entityCollisionOutput.velocity);

        const movementSpeed = 5;
        if (entityCollisionOutput.isOnGround) {
            let isMoving = false;
            const directiond2d = new THREE.Vector2(0, 0);
            if (this.keysPressed.has('KeyW')) {
                isMoving = true;
                directiond2d.y++;
            }
            if (this.keysPressed.has('KeyS')) {
                isMoving = true;
                directiond2d.y--;
            }
            if (this.keysPressed.has('KeyA')) {
                isMoving = true;
                directiond2d.x--;
            }
            if (this.keysPressed.has('KeyD')) {
                isMoving = true;
                directiond2d.x++;
            }
            if (this.keysPressed.has('Space')) {
                this.player.velocity.y = 20;
            }
            this.keysPressed.clear();

            if (isMoving) {
                const cameraFront = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
                const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();

                directiond2d.normalize().multiplyScalar(movementSpeed);
                this.player.velocity.x = cameraRight.x * directiond2d.x + cameraFront.x * directiond2d.y;
                this.player.velocity.z = cameraRight.z * directiond2d.x + cameraFront.z * directiond2d.y;
            } else {
                this.player.velocity.x = 0;
                this.player.velocity.z = 0;
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

                            this.voxelmapCollider.setChunk(patchId, {
                                ...voxelsChunkData,
                                isFull: false,
                            });
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
