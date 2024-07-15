import type * as THREE from 'three';

import { TerrainViewer, VoxelmapViewerAutonomous, type IHeightmap, type IVoxelMap } from '../lib';
import { HeightmapViewer } from '../lib/terrain/heightmap/heightmap-viewer';

import { TestBase } from './test-base';

class TestTerrainAutonomous extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewerAutonomous;

    public constructor(map: IVoxelMap & IHeightmap) {
        super(map);

        this.voxelmapViewer = new VoxelmapViewerAutonomous(map);

        const heightmapViewer = new HeightmapViewer(map, {
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
