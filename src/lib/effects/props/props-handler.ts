import { logger } from '../../helpers/logger';
import * as THREE from '../../libs/three-usage';

import { PropsBatch } from './props-batch';

type PropsHandlerStatistics = {
    batchesSize: number;
    batchesCount: number;
    batchesVisibleCount: number;
    totalInstancesCapacity: number;
    totalInstancesUsed: number;
    buffersSizeInBytes: number;
};

type Parameters = {
    readonly batchSize?: number;
    readonly minGroupPartSize?: number;
    readonly reactToPlayer?: boolean;
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
};

class PropsHandler {
    public readonly container: THREE.Object3D;

    private readonly batchSize: number;
    private readonly minGroupPartSize: number;

    private readonly reactToPlayer: boolean;
    private readonly bufferGeometry: THREE.BufferGeometry;
    private readonly material: THREE.MeshPhongMaterial;

    private viewDistance: number = 20;
    private viewDistanceMargin: number = 2;
    private playerViewPosition: THREE.Vector3Like = new THREE.Vector3(Infinity, Infinity, Infinity);

    private readonly batchesPerGroup: Map<string, Set<PropsBatch>>;
    private batches: PropsBatch[];

    private lastCameraPositionWorld: THREE.Vector3 | null = null;

    private automaticGarbageCollectHandle: number | null = null;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'props-handler';

        this.batchSize = params.batchSize ?? 5000;
        this.minGroupPartSize = params.minGroupPartSize ?? 200;

        this.reactToPlayer = params.reactToPlayer ?? false;
        this.bufferGeometry = params.bufferGeometry;
        this.material = params.material;

        if (this.batchSize === 0 || this.minGroupPartSize >= this.batchSize) {
            throw new Error(`Invalid parameters: minGroupPartSize="${this.minGroupPartSize}", batchSize="${this.batchSize}"`);
        }

        this.batchesPerGroup = new Map();
        this.batches = [];

        this.automaticGarbageCollectHandle = window.setInterval(() => { this.garbageCollect() }, 30000);
    }

    public setGroup(groupName: string, matricesList: ReadonlyArray<THREE.Matrix4>): void {
        if (this.hasGroup(groupName)) {
            this.deleteGroup(groupName);
        }
        this.batchesPerGroup.set(groupName, new Set());

        let remainingMatricesList = matricesList.slice(0);

        const addInstancesToBatch = (batch: PropsBatch, instancesCount: number): void => {
            if (instancesCount <= 0) {
                return;
            }

            const batchMatrices = remainingMatricesList.slice(0, instancesCount);
            remainingMatricesList = remainingMatricesList.slice(instancesCount);

            batch.setInstancesGroup(groupName, batchMatrices);
            this.updateBatchVisibility(batch);

            const batches = this.batchesPerGroup.get(groupName);
            if (!batches) {
                throw new Error('should not happen');
            }
            batches.add(batch);
        };

        // First, try to fit this group in existing batches
        for (const existingBatch of this.batches) {
            let instancesCountForThisBatch = 0;
            const freeInstancesCountInBatch = existingBatch.spareInstancesLeft;
            if (remainingMatricesList.length < freeInstancesCountInBatch) {
                // all the remaining instances fit in this batch
                instancesCountForThisBatch = remainingMatricesList.length;
            } else {
                // not all remaining instances fit in this batch
                if (freeInstancesCountInBatch >= this.minGroupPartSize) {
                    // but we can fit a section of the remaining matrices in this batch
                    instancesCountForThisBatch = freeInstancesCountInBatch;
                }
            }

            addInstancesToBatch(existingBatch, instancesCountForThisBatch);
        }

        // If there are more matrices to fit, create new batches
        while (remainingMatricesList.length > 0) {
            const newBatch = new PropsBatch({
                maxInstancesCount: this.batchSize,
                reactToPlayer: this.reactToPlayer,
                bufferGeometry: this.bufferGeometry,
                material: this.material,
            });
            newBatch.setViewDistance(this.viewDistance);
            newBatch.setViewDistanceMargin(this.viewDistanceMargin);
            newBatch.playerViewPosition.copy(this.playerViewPosition);
            this.container.add(newBatch.container);

            this.batches.push(newBatch);
            const instancesCountForNewBatch = Math.min(newBatch.spareInstancesLeft, remainingMatricesList.length);
            addInstancesToBatch(newBatch, instancesCountForNewBatch);
        }
    }

    public deleteGroup(groupName: string): void {
        const batchesForThisGroup = this.batchesPerGroup.get(groupName);
        if (!batchesForThisGroup) {
            throw new Error(`Unknown props group "${groupName}".`);
        }
        for (const batch of batchesForThisGroup) {
            batch.deleteInstancesGroup(groupName);
            this.updateBatchVisibility(batch);
        }
        this.batchesPerGroup.delete(groupName);
    }

    public hasGroup(groupName: string): boolean {
        return this.batchesPerGroup.has(groupName);
    }

    public dispose(): void {
        this.batchesPerGroup.clear();
        for (const batch of this.batches) {
            batch.dispose();
        }
        this.batches = [];
        this.container.clear();

        if (this.automaticGarbageCollectHandle) {
            window.clearInterval(this.automaticGarbageCollectHandle);
            this.automaticGarbageCollectHandle = null;
        }
    }

    public garbageCollect(): void {
        const usedBatches = new Set<PropsBatch>();
        for (const usedBatchesForGroup of this.batchesPerGroup.values()) {
            usedBatchesForGroup.forEach(usedBatchForGroup => usedBatches.add(usedBatchForGroup));
        }

        let garbageCollectedBatchesCount = 0;
        const usedBatchesList: PropsBatch[] = [];
        for (const batch of this.batches) {
            if (usedBatches.has(batch)) {
                usedBatchesList.push(batch);
            } else {
                if (batch.spareInstancesLeft !== this.batchSize) {
                    throw new Error(`No group registered for batch, yet the batch is not empty.`);
                }
                batch.dispose();
                this.container.remove(batch.container);
                garbageCollectedBatchesCount++;
            }
        }
        this.batches = usedBatchesList;
        logger.debug(`PropsHandler: garbage collected ${garbageCollectedBatchesCount} batches.`);
    }

    public getStatistics(): PropsHandlerStatistics {
        let batchesVisibleCount = 0;
        let totalInstancesUsed = 0;
        let buffersSizeInBytes = 0;
        for (const batch of this.batches) {
            totalInstancesUsed += this.batchSize - batch.spareInstancesLeft;
            buffersSizeInBytes += batch.getStatistics().buffersSizeInBytes;
            if (batch.container.visible) {
                batchesVisibleCount++;
            }
        }

        return {
            batchesSize: this.batchSize,
            batchesCount: this.batches.length,
            batchesVisibleCount,
            totalInstancesCapacity: this.batches.length * this.batchSize,
            totalInstancesUsed,
            buffersSizeInBytes,
        };
    }

    public setViewDistance(distance: number): void {
        this.viewDistance = distance;
        for (const batch of this.batches) {
            batch.setViewDistance(this.viewDistance);
        }
    }

    public setViewDistanceMargin(margin: number): void {
        this.viewDistanceMargin = margin;
        for (const batch of this.batches) {
            batch.setViewDistanceMargin(this.viewDistanceMargin);
        }
    }

    public setPlayerViewPosition(playerViewPosition: THREE.Vector3Like): void {
        this.playerViewPosition = new THREE.Vector3().copy(playerViewPosition);
        for (const batch of this.batches) {
            batch.playerViewPosition.copy(this.playerViewPosition);
        }
    }

    public updateVisibilities(cameraWorldPosition: THREE.Vector3Like): void {
        if (!this.lastCameraPositionWorld) {
            this.lastCameraPositionWorld = new THREE.Vector3();
        }
        this.lastCameraPositionWorld.copy(cameraWorldPosition);

        for (const batch of this.batches) {
            this.updateBatchVisibility(batch);
        }
    }

    private updateBatchVisibility(batch: PropsBatch): void {
        let distanceFromCamera = 0;
        if (this.lastCameraPositionWorld) {
            if (batch.container.boundingSphere) {
                distanceFromCamera = batch.container.boundingSphere.distanceToPoint(this.lastCameraPositionWorld);
            } else {
                logger.warn(`Batch does not have a bounding sphere.`);
            }
        }

        batch.container.visible = distanceFromCamera < this.viewDistance + 50;
    }
}

export { PropsHandler, type PropsHandlerStatistics };
