import * as THREE from 'three-usage-test';

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

    public constructor(map: IVoxelMap) {
        super();

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
    }

    protected override update(): void {
        const maxDistance = 500;
        const rayFrom = this.ray.group.getWorldPosition(new THREE.Vector3());
        const rayDirection = new THREE.Vector3(0, 1, 0).transformDirection(this.ray.group.matrixWorld);
        const rayTo = rayFrom.clone().addScaledVector(rayDirection, maxDistance);
        const intersection = this.voxelmapCollisions.rayCast(rayFrom, rayTo);
        const intersectionDistance = intersection?.distance ?? maxDistance;
        this.setRayLength(intersectionDistance);
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
