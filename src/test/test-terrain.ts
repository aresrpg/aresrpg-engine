import * as THREE from 'three';

import {
    EComputationMethod,
    PromisesQueue,
    TerrainViewer,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    type IHeightmap,
    type IVoxelMap,
} from '../lib';
import { HeightmapViewer } from '../lib/terrain/heightmap/heightmap-viewer';

import { TestBase } from './test-base';

class TestTerrain extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly map: IVoxelMap;

    public constructor(map: IVoxelMap & IHeightmap) {
        super(map);

        const chunkSize = { xz: 128, y: 64 };
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
            voxelRatio: 4,
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

        this.map = map;

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
}

export { TestTerrain };
