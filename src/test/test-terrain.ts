import type * as THREE from 'three';

import { Terrain } from '../lib';

import { TestBase } from './test-base';
import { type VoxelMap } from './voxel-map';

class TestTerrain extends TestBase {
    protected override readonly terrain: Terrain;

    public constructor(voxelMap: VoxelMap) {
        super(voxelMap);

        this.terrain = new Terrain(voxelMap, {
            patchSize: { xz: 128, y: 64 },
        });
        this.scene.add(this.terrain.container);
    }

    protected override showMapPortion(box: THREE.Box3): void {
        this.terrain.showMapPortion(box);
    }

    protected override showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void {
        this.terrain.showMapAroundPosition(position, radius, frustum);
    }
}

export { TestTerrain };
