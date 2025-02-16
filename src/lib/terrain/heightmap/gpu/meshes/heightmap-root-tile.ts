import type * as THREE from '../../../../libs/three-usage';
import { type MaterialsStore } from '../../../materials-store';
import { type IHeightmap } from '../../i-heightmap';

import { HeightmapRootTexture, type TileId } from './heightmap-root-texture';
import { HeightmapTile } from './heightmap-tile';
import { type TileGeometryStore } from './tile-geometry-store';

type Parameters = {
    readonly materialsStore: MaterialsStore;
    readonly geometryStore: TileGeometryStore;
    readonly heightmap: IHeightmap;
    readonly maxNesting: number;
    readonly tileId: { x: number; z: number };
    readonly baseCell: {
        readonly worldSize: number;
        readonly segmentsCount: number;
    };
    readonly flatShading: boolean;
};

class HeightmapRootTile extends HeightmapTile {
    private invisibleSinceTimestamp: number | null = null;

    public constructor(params: Parameters) {
        const worldSize = params.baseCell.worldSize * 2 ** params.maxNesting;
        const worldOrigin = {
            x: worldSize * params.tileId.x,
            z: worldSize * params.tileId.z,
        };

        const getWorldSize = (nestingLevel: number): number => {
            return worldSize / 2 ** nestingLevel;
        };

        const baseCellSizeInTexels = params.baseCell.segmentsCount;
        const rootTexture = new HeightmapRootTexture({
            materialsStore: params.materialsStore,
            baseCellSizeInTexels,
            texelSizeInWorld: params.baseCell.worldSize / baseCellSizeInTexels,
            maxNesting: params.maxNesting,
            geometryStore: params.geometryStore,
            altitude: params.heightmap.altitude,
            computeNormalsTexture: true,
        });

        super({
            root: {
                heightmap: params.heightmap,
                geometryStore: params.geometryStore,
                texture: rootTexture,
                getWorldTransform(localTileId: TileId) {
                    const tileSize = getWorldSize(localTileId.nestingLevel);
                    const tileOriginWorld = {
                        x: worldOrigin.x + tileSize * localTileId.localCoords.x,
                        z: worldOrigin.z + tileSize * localTileId.localCoords.z,
                    };
                    return { size: tileSize, origin: tileOriginWorld };
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
