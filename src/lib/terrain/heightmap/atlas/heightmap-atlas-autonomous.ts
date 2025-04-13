import { logger } from '../../../helpers/logger';
import type * as THREE from '../../../libs/three-usage';
import { type MaterialsStore } from '../../materials-store';
import type { HeightmapSamples, IHeightmap } from '../i-heightmap';

import { type AtlasTileId, HeightmapAtlas } from './heightmap-atlas';

type Parameters = {
    readonly heightmap: IHeightmap;
    readonly heightmapQueries: {
        readonly interval: number;
        readonly batchSize: number;
        readonly maxParallelQueries: number;
    };
    readonly materialsStore: MaterialsStore;
    readonly texelSizeInWorld: number;
    readonly leafTileSizeInWorld: number;
    readonly maxTextureSize?: number;
    readonly maintainanceInterval?: number;
};

class HeightmapAtlasAutonomous extends HeightmapAtlas {
    private lastQueriesTimestamp: number | null = null;

    private readonly heightmap: IHeightmap;

    private readonly queriesInterval: number;
    private readonly queriesBatchSize: number;
    private readonly maxParallelQueries: number;

    public constructor(params: Parameters) {
        super({
            ...params,
            altitude: params.heightmap.altitude,
        });

        this.heightmap = params.heightmap;

        this.queriesInterval = params.heightmapQueries.interval;
        this.queriesBatchSize = params.heightmapQueries.batchSize;
        this.maxParallelQueries = params.heightmapQueries.maxParallelQueries;

        if (this.queriesBatchSize <= 0) {
            throw new Error(`Batch size cannot be <= 0 (is ${this.queriesBatchSize})`);
        }
        if (this.maxParallelQueries <= 0) {
            throw new Error(`Max parallel queries cannot be <= 0 (is ${this.maxParallelQueries})`);
        }
    }

    public override update(renderer: THREE.WebGLRenderer): void {
        super.update(renderer);

        const now = performance.now();
        if (this.lastQueriesTimestamp === null || now - this.lastQueriesTimestamp > this.queriesInterval) {
            this.solvePendingRequests();
            this.lastQueriesTimestamp = now;
        }
    }

    private solvePendingRequests(): void {
        const pendingRequestsTilesIds = this.getTilesNeedingData();

        let allowedQueriesCount = this.maxParallelQueries - this.getPendingQueriesCount();

        while (pendingRequestsTilesIds.length > 0 && allowedQueriesCount > 0) {
            const batch = pendingRequestsTilesIds.splice(0, this.queriesBatchSize);
            void this.sendRequestsBatch(batch);
            allowedQueriesCount--;
        }
    }

    private async sendRequestsBatch(batchTileIds: ReadonlyArray<AtlasTileId>): Promise<void> {
        if (batchTileIds.length === 0) {
            return;
        }

        const samplesPerTileId = this.normalizedPositions.length / 2;
        const batchWorldPositions = new Float32Array(batchTileIds.length * 2 * samplesPerTileId);
        batchTileIds.forEach((tileId: AtlasTileId, index: number) => {
            const offset = index * 2 * samplesPerTileId;
            const tileWorldPositions = batchWorldPositions.subarray(offset, offset + 2 * samplesPerTileId);
            this.fillTileSamplesPositions(tileId, tileWorldPositions);
        });

        const requestId = Symbol('heightmap-atlas-request');
        for (const tileId of batchTileIds) {
            const tileIdString = this.tileIdToString(tileId);
            this.pendingUpdates.set(tileIdString, { tileId, requestId, state: 'pending-response' });
        }

        const result = this.heightmap.sampleHeightmap(batchWorldPositions);
        let batchHeightmapSamples: HeightmapSamples | null = null;
        if (result instanceof Promise) {
            try {
                batchHeightmapSamples = await result;
            } catch (error: unknown) {
                logger.warn(`Query for HeightmapAtlasAutonomous tiles failed, will retry later. Error: ${error}`);
            }
        } else {
            batchHeightmapSamples = result;
        }

        batchTileIds.forEach((tileId: AtlasTileId, index: number) => {
            const tileIdString = this.tileIdToString(tileId);
            const currentState = this.pendingUpdates.get(tileIdString);
            if (currentState?.state === 'pending-response' && currentState.requestId === requestId) {
                if (batchHeightmapSamples) {
                    const offset = index * samplesPerTileId;
                    this.pushTileData(tileId, {
                        altitudes: batchHeightmapSamples.altitudes.subarray(offset, offset + samplesPerTileId),
                        materialIds: batchHeightmapSamples.materialIds.subarray(offset, offset + samplesPerTileId),
                    });
                } else {
                    this.pendingUpdates.delete(tileIdString);
                }
            } else {
                logger.debug(`Ignoring result of sampleHeightmap for tile ${tileIdString}`);
            }
        });
    }

    private getPendingQueriesCount(): number {
        let count = 0;
        for (const pendingUpdate of this.pendingUpdates.values()) {
            if (pendingUpdate.state === 'pending-response') {
                count++;
            }
        }
        return count;
    }
}

export { HeightmapAtlasAutonomous };
