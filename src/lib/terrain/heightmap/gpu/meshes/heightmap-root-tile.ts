import { type IHeightmap, type IHeightmapCoords } from '../../i-heightmap';
import type * as THREE from '../../../../libs/three-usage';

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
    readonly flatShading: boolean;
};

class HeightmapRootTile extends HeightmapTile {
    private invisibleSinceTimestamp: number | null = null;

    public constructor(params: Parameters) {
        const rootTexture = new HeightmapRootTexture({
            baseCellSizeInTexels: params.segmentsCount,
            texelSizeInWorld: 2,
            maxNesting: params.maxNesting,
            geometryStore: params.geometryStore,
            minAltitude: params.heightmap.minAltitude,
            maxAltitude: params.heightmap.maxAltitude,
            computeNormalsTexture: true,
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
                getWorldSize(nestingLevel: number): number {
                    return params.sizeWorld / 2 ** nestingLevel;
                },
            },
            localTileId: { nestingLevel: 0, localCoords: { x: 0, z: 0 } },
            flatShading: params.flatShading,
        });
    }

    public override update(renderer: THREE.WebGLRenderer): void {
        super.update(renderer);
        this.root.texture.update(renderer);
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

    public getTotalGpuMemoryBytes(): number {
        return this.root.texture.getTotalGpuMemoryBytes();
    }

    public override dispose(): void {
        this.root.texture.dispose();
        super.dispose();
    }
}

export { HeightmapRootTile, type Parameters };
