import { type QuadtreeNodeId } from '../quadtree/quadtree-node';

import { HeightmapRootTexture } from './heightmap-root-texture';
import { HeightmapTile } from './heightmap-tile';
import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly segmentsCount: number;
    readonly maxNesting: number;
    readonly quadtreeNodeId: QuadtreeNodeId;
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
            worldNodeId: params.quadtreeNodeId,
        });
    }

    public override dispose(): void {
        this.root.texture.dispose();
        super.dispose();
    }
}

export { HeightmapRootTile, type Parameters };
