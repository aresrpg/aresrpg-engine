import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import {
    computePlateau,
    EComputationMethod,
    type PlateauRenderable,
    PlateauRenderableFactory,
    PromisesQueue,
    TerrainViewer,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    type IHeightmap,
    type IVoxelMap,
    VoxelmapWrapper,
    type Plateau,
} from '../lib';
import { HeightmapViewer } from '../lib/terrain/heightmap/heightmap-viewer';

import { TestBase, type ITerrainMap } from './test-base';

class TestTerrain extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly map: VoxelmapWrapper;

    public constructor(map: IVoxelMap & IHeightmap & ITerrainMap) {
        super(map);

        const testPlateau = true;
        if (testPlateau) {
            this.setupPlateau(map);
        }

        const chunkSize = { xz: 64, y: 64 };
        const minChunkIdY = Math.floor(map.minAltitude / chunkSize.y);
        const maxChunkIdY = Math.floor(map.maxAltitude / chunkSize.y);

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, map.voxelMaterialsList, {
            patchSize: chunkSize,
            computationOptions: {
                method: EComputationMethod.CPU_MULTITHREADED,
                threadsCount: 4,
            },
        });

        const heightmapViewer = new HeightmapViewer(map, {
            basePatchSize: chunkSize.xz,
            maxLevel: 5,
            voxelRatio: 2,
        });

        this.terrainViewer = new TerrainViewer(heightmapViewer, this.voxelmapViewer);
        // this.terrainViewer.parameters.lod.enabled = false;
        this.terrainViewer.parameters.lod.wireframe = true;
        this.scene.add(this.terrainViewer.container);

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(
            this.voxelmapViewer.patchSize,
            this.voxelmapViewer.minChunkIdY,
            this.voxelmapViewer.maxChunkIdY
        );

        this.map = new VoxelmapWrapper(map, chunkSize, minChunkIdY, maxChunkIdY);
        this.map.onChange.push(modifiedPatchesIdsList => {
            if (modifiedPatchesIdsList.length > 0) {
                this.promisesQueue.cancelAll();
                for (const patchId of modifiedPatchesIdsList) {
                    this.voxelmapViewer.deletePatch(patchId);
                }
            }
        });
        this.promisesQueue = new PromisesQueue(this.voxelmapViewer.maxPatchesComputedInParallel + 5);
    }

    protected override showMapPortion(box: THREE.Box3): void {
        this.voxelmapVisibilityComputer.showMapPortion(box);
        this.applyVisibility();
    }

    protected override showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void {
        this.voxelmapVisibilityComputer.reset();
        this.voxelmapVisibilityComputer.showMapAroundPosition(position, radius, frustum);
        this.applyVisibility();
    }

    private applyVisibility(): void {
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
                            // const computationStatus =
                            await this.voxelmapViewer.enqueuePatch(patchId, voxelsChunkData);
                            // console.log(`${patchId.asString} computation status: ${computationStatus}`);
                        }
                    },
                    () => {
                        this.voxelmapViewer.dequeuePatch(patchId);
                        // console.log(`${patchId.asString} query & computation cancelled`);
                    }
                );
            }
        }
    }

    private setupPlateau(voxelMap: IVoxelMap & ITerrainMap): void {
        const factory = new PlateauRenderableFactory({
            voxelMaterialsList: voxelMap.voxelMaterialsList,
        });

        const plateauContainer = new THREE.Group();
        this.scene.add(plateauContainer);
        let currentPlateau: {
            plateau: Plateau;
            renderable: PlateauRenderable;
        } | null = null;

        let lastPlateauRequestId = -1;
        const requestPlateau = async (origin: THREE.Vector3Like) => {
            lastPlateauRequestId++;
            const requestId = lastPlateauRequestId;

            const plateau = await computePlateau(voxelMap, origin);
            const renderable = await factory.buildPlateauRenderable(plateau);

            if (lastPlateauRequestId !== requestId) {
                return; // another request was launched in the meantime
            }

            plateauContainer.clear();
            if (currentPlateau) {
                currentPlateau.renderable.dispose();
                this.map.unregisterPlateau(currentPlateau.plateau);
            }
            currentPlateau = { renderable, plateau };
            plateauContainer.add(currentPlateau.renderable.container);
            this.map.registerPlateau(currentPlateau.plateau);
        };

        const plateauCenterContainer = new THREE.Group();
        const plateauCenter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }));
        plateauCenter.position.set(0.5, 0.5, 0.5);
        plateauCenterContainer.add(plateauCenter);

        const updateAltitude = () => {
            const terrainSample = voxelMap.sampleHeightmapBaseTerrain(
                Math.floor(plateauCenterContainer.position.x),
                Math.floor(plateauCenterContainer.position.z)
            );
            plateauCenterContainer.position.setY(terrainSample.altitude + 1);
            requestPlateau(plateauCenterContainer.position.clone());
        };
        updateAltitude();

        const plateauCenterControls = new TransformControls(this.camera, this.renderer.domElement);
        plateauCenterControls.showY = false;
        plateauCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        plateauCenterControls.addEventListener('change', updateAltitude);
        plateauCenterControls.attach(plateauCenterContainer);

        this.scene.add(plateauCenterContainer);
        this.scene.add(plateauCenterControls);
    }
}

export { TestTerrain };
