import { type IHeightmap, type IHeightmapCoords } from '../../i-heightmap';

import { HeightmapRootTexture, type TileId } from './heightmap-root-texture';
import { HeightmapTile } from './heightmap-tile';
import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly geometryStore: TileGeometryStore;
    readonly heightmap: IHeightmap;
    readonly segmentsCount: number;
    readonly maxNesting: number;
    readonly sizeWorld: number;
    readonly originWorld: {
        readonly x: number;
        readonly z: number;
    };
};

class HeightmapRootTile extends HeightmapTile {
    public constructor(params: Parameters) {
        const rootTexture = new HeightmapRootTexture({
            baseCellSize: params.segmentsCount,
            maxNesting: params.maxNesting,
            geometryStore: params.geometryStore,
            minAltitude: params.heightmap.minAltitude,
            maxAltitude: params.heightmap.maxAltitude,
        });

        const rootSize = params.sizeWorld;
        const rootOriginWorldX = params.originWorld.x;
        const rootOriginWorldZ = params.originWorld.z;

        super({
            root: {
                heightmap: params.heightmap,
                geometryStore: params.geometryStore,
                texture: rootTexture,
                convertToWorldPositions: (
                    localTileId: TileId,
                    normalizedPositions: ReadonlyArray<IHeightmapCoords>
                ): IHeightmapCoords[] => {
                    const tileSize = rootSize / 2 ** localTileId.nestingLevel;
                    const tileOriginWorldX = rootOriginWorldX + tileSize * localTileId.localCoords.x;
                    const tileOriginWorldZ = rootOriginWorldZ + tileSize * localTileId.localCoords.z;

                    return normalizedPositions.map(normalizedPosition => {
                        return {
                            x: tileOriginWorldX + tileSize * normalizedPosition.x,
                            z: tileOriginWorldZ + tileSize * normalizedPosition.z,
                        };
                    });
                },
            },
            localTileId: { nestingLevel: 0, localCoords: { x: 0, z: 0 } },
        });
    }

    public override dispose(): void {
        this.root.texture.dispose();
        super.dispose();
    }
}

export { HeightmapRootTile, type Parameters };
