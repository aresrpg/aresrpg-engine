import type * as THREE from 'three-usage-test';

import { HeightmapViewerCpu, TerrainViewer, VoxelmapViewerAutonomous, type IHeightmap, type IVoxelMap } from '../lib';

import { TestTerrainBase, type ITerrainMap } from './test-terrain-base';

class TestTerrainAutonomous extends TestTerrainBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewerAutonomous;

    public constructor(map: IVoxelMap & IHeightmap & ITerrainMap) {
        super(map);

        this.voxelmapViewer = new VoxelmapViewerAutonomous(map);

        const heightmapViewer = new HeightmapViewerCpu(map, {
            basePatchSize: this.voxelmapViewer.chunkSize.xz,
            maxLevel: 5,
            voxelRatio: 2,
        });

        this.terrainViewer = new TerrainViewer(heightmapViewer, this.voxelmapViewer);
        this.scene.add(this.terrainViewer.container);
    }

    protected override showMapPortion(box: THREE.Box3): void {
        this.voxelmapViewer.showMapPortion(box);
    }

    protected override showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void {
        this.voxelmapViewer.showMapAroundPosition(position, radius, frustum);
    }
}

export { TestTerrainAutonomous };
