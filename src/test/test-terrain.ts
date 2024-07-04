import * as THREE from 'three';

import { TerrainViewer, VoxelmapViewer, type IHeightmap, type IVoxelMap } from '../lib';
import { PromisesQueue } from '../lib/helpers/promise-queue';
import { VoxelmapVisibilityComputer } from '../lib/terrain/voxelmap/voxelmap-visibility-computer';

import { TestBase } from './test-base';

class TestTerrain extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue = new PromisesQueue(5);

    private readonly map: IVoxelMap;

    public constructor(map: IVoxelMap & IHeightmap) {
        super(map);

        const chunkSize = { xz: 128, y: 64 };
        const minChunkIdY = Math.floor(map.minAltitude / chunkSize.y);
        const maxChunkIdY = Math.floor(map.maxAltitude / chunkSize.y);

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, map.voxelMaterialsList, { chunkSize });
        this.terrainViewer = new TerrainViewer(map, this.voxelmapViewer);

        this.terrainViewer.parameters.lod.enabled = false;
        this.scene.add(this.terrainViewer.container);

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(
            this.voxelmapViewer.patchSize,
            this.voxelmapViewer.minChunkIdY,
            this.voxelmapViewer.maxChunkIdY
        );

        this.map = map;
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
            if (this.voxelmapViewer.canPatchBeEnqueued(patchId)) {
                this.promisesQueue.run(
                    async () => {
                        if (this.voxelmapViewer.canPatchBeEnqueued(patchId)) {
                            const voxelsChunkBox = this.voxelmapViewer.getVoxelsChunkBox(patchId);
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
