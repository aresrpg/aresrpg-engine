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

type PropsGroupProperties = {
    readonly batches: Set<PropsBatch>;
    readonly boundingSphere: THREE.Sphere;
    readonly instancesCount: number;
    invisibleSince: number | null;
};

type Parameters = {
    readonly batchSize?: number;
    readonly minGroupPartSize?: number;
    readonly reactToPlayer?: boolean;
    readonly reactToWind?: boolean;
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
    readonly garbageCollect?: {
        readonly interval?: number;
        readonly invisibleGroupsCacheSize?: number;
    };
};

class PropsHandler {
    public readonly container: THREE.Object3D;

    private readonly batchSize: number;
    private readonly minGroupPartSize: number;

    private readonly reactToPlayer: boolean;
    private readonly reactToWind: boolean;
    private readonly bufferGeometry: THREE.BufferGeometry;
    private readonly material: THREE.MeshPhongMaterial;

    private readonly bufferGeometryBoundingSphere: THREE.Sphere;

    private viewDistance: number = 20;
    private viewDistanceMargin: number = 2;
    private playerViewPosition: THREE.Vector3Like = new THREE.Vector3(Infinity, Infinity, Infinity);

    private readonly groups: Map<string, PropsGroupProperties>;
    private batches: PropsBatch[];

    private lastCameraPositionWorld: THREE.Vector3 | null = null;

    private automaticGarbageCollectHandle: number | null = null;
    private readonly invisibleGroupsCacheSize: number;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'props-handler';

        this.batchSize = params.batchSize ?? 5000;
        this.minGroupPartSize = params.minGroupPartSize ?? 200;

        this.reactToPlayer = params.reactToPlayer ?? false;
        this.reactToWind = params.reactToWind ?? false;
        this.bufferGeometry = params.bufferGeometry;
        this.material = params.material;

        if (!this.bufferGeometry.boundingSphere) {
            this.bufferGeometry.computeBoundingSphere();
        }
        this.bufferGeometryBoundingSphere = this.bufferGeometry.boundingSphere!.clone();

        if (this.batchSize === 0 || this.minGroupPartSize >= this.batchSize) {
            throw new Error(`Invalid parameters: minGroupPartSize="${this.minGroupPartSize}", batchSize="${this.batchSize}"`);
        }

        this.groups = new Map();
        this.batches = [];

        const garbageCollectInterval = params.garbageCollect?.interval ?? 30000;
        this.automaticGarbageCollectHandle = window.setInterval(() => {
            this.garbageCollect();
        }, garbageCollectInterval);

        this.invisibleGroupsCacheSize = params.garbageCollect?.invisibleGroupsCacheSize ?? 150;

        if (this.invisibleGroupsCacheSize < 0) {
            throw new Error(`Invisible groups cache size must be positive (received ${this.invisibleGroupsCacheSize})`);
        }
    }

    public setGroup(groupName: string, matricesList: ReadonlyArray<THREE.Matrix4>): void {
        if (this.hasGroup(groupName)) {
            this.deleteGroup(groupName);
        }
        const groupProperties: PropsGroupProperties = {
            batches: new Set(),
            boundingSphere: new THREE.Sphere(),
            instancesCount: matricesList.length,
            invisibleSince: null,
        };
        const tempSphere = new THREE.Sphere();
        for (const matrix of matricesList) {
            tempSphere.copy(this.bufferGeometryBoundingSphere).applyMatrix4(matrix);
            groupProperties.boundingSphere.union(tempSphere);
        }

        this.groups.set(groupName, groupProperties);

        let remainingMatricesList = matricesList.slice(0);

        const addInstancesToBatch = (batch: PropsBatch, instancesCount: number): void => {
            if (instancesCount <= 0) {
                return;
            }

            const batchMatrices = remainingMatricesList.slice(0, instancesCount);
            remainingMatricesList = remainingMatricesList.slice(instancesCount);

            batch.setInstancesGroup(groupName, batchMatrices);
            this.updateBatchVisibility(batch);

            const batches = this.groups.get(groupName);
            if (!batches) {
                throw new Error('should not happen');
            }
            batches.batches.add(batch);
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
        let countOfCreatedBatches = 0;
        while (remainingMatricesList.length > 0) {
            const newBatch = new PropsBatch({
                maxInstancesCount: this.batchSize,
                reactToPlayer: this.reactToPlayer,
                reactToWind: this.reactToWind,
                bufferGeometry: this.bufferGeometry,
                material: this.material,
            });
            newBatch.setViewDistance(this.viewDistance);
            newBatch.setViewDistanceMargin(this.viewDistanceMargin);
            newBatch.playerViewPosition.copy(this.playerViewPosition);
            this.container.add(newBatch.container);
            countOfCreatedBatches++;

            this.batches.push(newBatch);
            const instancesCountForNewBatch = Math.min(newBatch.spareInstancesLeft, remainingMatricesList.length);
            addInstancesToBatch(newBatch, instancesCountForNewBatch);
        }

        if (countOfCreatedBatches > 0) {
            logger.debug(`PropsHandler: created "${countOfCreatedBatches}" new batches of size "${this.batchSize}".`);
        }
    }

    public deleteGroup(groupName: string): void {
        const groupProperties = this.groups.get(groupName);
        if (!groupProperties) {
            throw new Error(`Unknown props group "${groupName}".`);
        }
        for (const batch of groupProperties.batches) {
            batch.deleteInstancesGroup(groupName);
            this.updateBatchVisibility(batch);
        }
        this.groups.delete(groupName);
    }

    public hasGroup(groupName: string): boolean {
        return this.groups.has(groupName);
    }

    public dispose(): void {
        this.groups.clear();
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
        this.garbageCollectGroups();
        this.garbageCollectBatches();
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
        this.updateGroupsVisibilities();
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

        this.updateGroupsVisibilities();
    }

    public update(deltaMilliseconds: number): void {
        for (const batch of this.batches) {
            batch.update(deltaMilliseconds);
        }
    }

    private garbageCollectGroups(): void {
        const invisibleGroups: [string, number][] = [];
        for (const [name, properties] of this.groups.entries()) {
            if (properties.invisibleSince !== null && properties.instancesCount > 0) {
                invisibleGroups.push([name, properties.invisibleSince]);
            }
        }
        invisibleGroups.sort((group1, group2) => group1[1] - group2[1]);

        let garbageCollectedGroupsCount = 0;
        while (invisibleGroups.length > this.invisibleGroupsCacheSize) {
            const oldestGroup = invisibleGroups.shift()!;
            const oldestGroupId = oldestGroup[0];
            this.deleteGroup(oldestGroupId);
            garbageCollectedGroupsCount++;
        }
        if (garbageCollectedGroupsCount > 0) {
            logger.debug(`PropsHandler: garbage collected ${garbageCollectedGroupsCount} groups.`);
        }
    }

    private garbageCollectBatches(): void {
        const usedBatches = new Set<PropsBatch>();
        for (const groupProperties of this.groups.values()) {
            groupProperties.batches.forEach(usedBatchForGroup => usedBatches.add(usedBatchForGroup));
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

        if (garbageCollectedBatchesCount > 0) {
            logger.debug(`PropsHandler: garbage collected ${garbageCollectedBatchesCount} batches.`);
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

    private updateGroupsVisibilities(): void {
        for (const groupProperties of this.groups.values()) {
            let isVisible = true;
            if (this.lastCameraPositionWorld) {
                const distance = groupProperties.boundingSphere.distanceToPoint(this.lastCameraPositionWorld);
                isVisible = distance < this.viewDistance;
            }

            if (isVisible) {
                groupProperties.invisibleSince = null;
            } else if (groupProperties.invisibleSince === null) {
                groupProperties.invisibleSince = performance.now();
            }
        }
    }
}

export { PropsHandler, type Parameters, type PropsHandlerStatistics };
