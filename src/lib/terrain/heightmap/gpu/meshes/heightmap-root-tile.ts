import * as THREE from '../../../../libs/three-usage';

import { HeightmapRootTexture } from './heightmap-root-texture';
import { HeightmapTile } from './heightmap-tile';
import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly segmentsCount: number;
    readonly maxNesting: number;
};

class HeightmapRootTile extends HeightmapTile {
    public constructor(params: Parameters) {
        const rootTexture = new HeightmapRootTexture({
            baseCellSize: params.segmentsCount + 1,
            maxNesting: params.maxNesting,
            elevationScale: 150,
        });

        super({
            geometryStore: params.geometryStore,
            rootTexture,
            uv: {
                scale: 1,
                shift: new THREE.Vector2(0, 0),
            },
        });
    }

    public override dispose(): void {
        this.rootTexture.dispose();
        super.dispose();
    }
}

export { HeightmapRootTile, type Parameters };
