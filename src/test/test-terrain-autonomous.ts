import type * as THREE from 'three';

import { TerrainViewer, VoxelmapViewerAutonomous, type IHeightmap, type IVoxelMap } from '../lib';

import { TestBase } from './test-base';

class TestTerrainAutonomous extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewerAutonomous;

    public constructor(map: IVoxelMap & IHeightmap) {
        super(map);

        this.voxelmapViewer = new VoxelmapViewerAutonomous(map);
        this.terrainViewer = new TerrainViewer(map, this.voxelmapViewer);
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
