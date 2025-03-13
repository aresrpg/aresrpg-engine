import type { HeightmapAtlas } from '../../atlas/heightmap-atlas';

import type { TileGeometryStore } from './tile-geometry-store';
import { HeightmapTile } from './heightmap-tile';

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly heightmapAtlas: HeightmapAtlas;
    readonly tileId: { x: number; z: number };
    readonly flatShading: boolean;
    readonly transitionTime: number;
};

class HeightmapRootTile extends HeightmapTile {
    private invisibleSinceTimestamp: number | null = null;

    public constructor(params: Parameters) {
        super({
            common: {
                geometryStore: params.geometryStore,
                heightmapAtlas: params.heightmapAtlas,
            },
            atlasTileId: { nestingLevel: 0, x: params.tileId.x, y: params.tileId.z },
            flatShading: params.flatShading,
            transitionTime: params.transitionTime,
        });
    }

    public override setVisibility(visible: boolean): void {
        super.setVisibility(visible);

        if (visible) {
            this.invisibleSinceTimestamp = null;
        } else if (this.invisibleSinceTimestamp === null) {
            this.invisibleSinceTimestamp = performance.now();
        }
    }

    public isInvisibleSince(): number | null {
        return this.invisibleSinceTimestamp;
    }
}

export { HeightmapRootTile, type Parameters };
