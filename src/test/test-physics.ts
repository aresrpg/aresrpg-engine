import * as THREE from 'three-usage-test';
import GUI from 'lil-gui';

import {
    EComputationMethod,
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
        readonly mesh: THREE.Mesh;
        readonly collider: THREE.Sphere;
        readonly velocity: THREE.Vector3;
        touchesFloor: boolean;
    };

    private lastUpdate: number | null = null;

    private readonly keyDown = new Map<string, boolean>();

    public constructor(map: IVoxelMap) {
        super();

        const gui = new GUI();
        gui.add(this, "maxFps", 1, 120, 1);

        this.camera.position.set(50, 200, 50);
        this.cameraControl.target.set(0, 170, 0);

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
        this.voxelmapVisibilityComputer.showMapAroundPosition({ x: 0, y: 0, z: 0 }, 500);

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

        const playerSphereRadius = 1.1;
        this.player = {
            mesh: new THREE.Mesh(new THREE.SphereGeometry(playerSphereRadius), new THREE.MeshPhongMaterial({ color: 0xdddddd })),
            collider: new THREE.Sphere(new THREE.Vector3(0.5, 160, 0.5), playerSphereRadius),
            velocity: new THREE.Vector3(0, 0, 0),
            touchesFloor: false,
        };
        this.scene.add(this.player.mesh);

        const sphereRadius = 1.1;
        const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius), new THREE.MeshPhongMaterial({ color: 0xdddddd }));

        window.addEventListener("keyup", event => {
            if (event.code === "Space") {
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
        window.addEventListener("keydown", event => {
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

        const gravity = 80;

        for (const sphere of this.spheres) {
            sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);
            sphere.mesh.position.copy(sphere.collider.center);

            const result = this.voxelmapCollisions.sphereIntersect(sphere.collider);
            if (result) {
                sphere.velocity.addScaledVector(result.normal, - result.normal.dot(sphere.velocity) * 1.5);
                sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
            } else {
                sphere.velocity.y -= gravity * deltaTime;
            }

            const damping = Math.exp(-0.5 * deltaTime) - 1;
            sphere.velocity.addScaledVector(sphere.velocity, damping);
        }

        {
            this.player.collider.center.addScaledVector(this.player.velocity, deltaTime);
            this.player.mesh.position.copy(this.player.collider.center);

            this.player.touchesFloor = false;

            const result = this.voxelmapCollisions.sphereIntersect(this.player.collider);
            if (result) {
                // result.normal.x *= 0.5;
                // result.normal.z *= 0.5;
                this.player.velocity.addScaledVector(result.normal, - result.normal.dot(this.player.velocity) * 1.1);
                this.player.collider.center.add(result.normal.multiplyScalar(result.depth));
                if (result.normal.y > 0) {
                    this.player.touchesFloor = true;
                }
            } else {
                this.player.velocity.y -= gravity * deltaTime;
            }

            const damping = Math.exp(-1 * deltaTime) - 1;
            this.player.velocity.addScaledVector(this.player.velocity, damping);

            if (this.player.touchesFloor) {
                const directiond2d = new THREE.Vector2(0, 0);
                if (this.keyDown.get("KeyW")) {
                    directiond2d.y++;
                }
                if (this.keyDown.get("KeyS")) {
                    directiond2d.y--;
                }
                if (this.keyDown.get("KeyA")) {
                    directiond2d.x--;
                }
                if (this.keyDown.get("KeyD")) {
                    directiond2d.x++;
                }

                const cameraFront = new THREE.Vector3(0, 0, -1)
                    .applyQuaternion(this.camera.quaternion)
                    .setY(0)
                    .normalize();
                const cameraRight = new THREE.Vector3(1, 0, 0)
                    .applyQuaternion(this.camera.quaternion)
                    .setY(0)
                    .normalize()

                directiond2d.normalize().multiplyScalar(100 * deltaTime);
                this.player.velocity.addScaledVector(cameraRight, directiond2d.x).addScaledVector(cameraFront, directiond2d.y);

                // this.cameraControl.target.copy(this.player.collider.center);
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
