import * as THREE from '../../../../libs/three-usage';

import { type TileGeometryStore } from './tile-geometry-store';
import { HeightmapTile } from './heightmap-tile';

type Parameters = {
    readonly geometryStore: TileGeometryStore;
};

class HeightmapRootTile extends HeightmapTile {
    public constructor(params: Parameters) {
        super({
            geometryStore: params.geometryStore,
            data: {
                texture: new THREE.TextureLoader().load('height.png'),
                elevationScale: 150,
                uv: {
                    scale: 1,
                    shift: new THREE.Vector2(0, 0),
                },
            },
        });
    }
}

export { HeightmapRootTile, type Parameters };
