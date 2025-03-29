import { logger } from '../../../helpers/logger';
import type * as THREE from '../../../libs/three-usage';
import type { HeightmapSamples } from '../i-heightmap';

import { type AtlasTileId, HeightmapAtlas, type Parameters as HeightmapAtlasParameters } from './heightmap-atlas';

type Parameters = HeightmapAtlasParameters & {
    readonly heightmapQueries: {
        readonly interval: number;
        readonly batching: number;
    };
};

class HeightmapAtlasAutonomous extends HeightmapAtlas {
    private lastQueriesTimestamp: number | null = null;

    private readonly queriesInterval: number;
    private readonly queriesBatchSize: number;

    public constructor(params: Parameters) {
        super(params);

        this.queriesInterval = params.heightmapQueries.interval;
        this.queriesBatchSize = params.heightmapQueries.batching;
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

        let currentBatch: AtlasTileId[] = [];
        for (const tileId of pendingRequestsTilesIds) {
            currentBatch.push(tileId);
            if (currentBatch.length >= this.queriesBatchSize) {
                void this.sendRequestsBatch(currentBatch);
                currentBatch = [];
            }
        }
        void this.sendRequestsBatch(currentBatch);
    }

    private async sendRequestsBatch(batchTileIds: ReadonlyArray<AtlasTileId>): Promise<void> {
        if (batchTileIds.length === 0) {
            return;
        }

        const samplesPerTileId = this.tileGrid.normalizedPositions.length / 2;
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
}

export { HeightmapAtlasAutonomous };
