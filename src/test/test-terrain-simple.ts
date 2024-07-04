import * as THREE from 'three';

import { PromiseThrottler } from '../lib/helpers/promise-throttler';
import { TerrainSimple } from '../lib/terrain/terrain-simple';
import { VoxelmapVisibilityComputer } from '../lib/terrain/voxelmap/voxelmap-visibility-computer';

import { TestBase } from './test-base';
import { type VoxelMap } from './voxel-map';

class TestTerrainSimple extends TestBase {
    protected override readonly terrain: TerrainSimple;

    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promiseThrottler = new PromiseThrottler(5);

    private readonly map: VoxelMap;

    public constructor(voxelMap: VoxelMap) {
        super(voxelMap);

        this.terrain = new TerrainSimple(voxelMap, voxelMap.voxelMaterialsList, {
            patchSize: { xz: 128, y: 64 },
        });
        this.terrain.parameters.lod.enabled = false;
        this.scene.add(this.terrain.container);

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(
            this.terrain.patchSize,
            this.terrain.minPatchIdY,
            this.terrain.maxPatchIdY
        );

        this.map = voxelMap;
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

        this.terrain.setVisibility(patchesIdToDisplay);

        this.promiseThrottler.cancelAll();
        for (const patchId of patchesIdToDisplay) {
            if (this.terrain.canPatchBeEnqueued(patchId)) {
                this.promiseThrottler.run(
                    async () => {
                        if (this.terrain.canPatchBeEnqueued(patchId)) {
                            const voxelsChunkBox = this.terrain.getVoxelsChunkBox(patchId);
                            const blockStart = voxelsChunkBox.min;
                            const blockEnd = voxelsChunkBox.max;

                            const patchMapData = await this.map.getLocalMapData(blockStart, blockEnd);
                            const voxelsChunkData = Object.assign(patchMapData, {
                                size: new THREE.Vector3().subVectors(blockEnd, blockStart),
                            });
                            // const computationStatus =
                            await this.terrain.enqueuePatch(patchId, voxelsChunkData);
                            // console.log(`${patchId.asString} computation status: ${computationStatus}`);
                        }
                    },
                    () => {
                        this.terrain.dequeuePatch(patchId);
                        // console.log(`${patchId.asString} query & computation cancelled`);
                    }
                );
            }
        }
    }
}

export { TestTerrainSimple };
