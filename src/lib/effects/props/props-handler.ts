import * as THREE from '../../libs/three-usage';

import { PropsBatch } from './props-batch';

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

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'props-handler';

        this.batchSize = params.batchSize ?? 20000;
        this.minGroupPartSize = params.minGroupPartSize ?? 1000;

        this.reactToPlayer = params.reactToPlayer ?? false;
        this.bufferGeometry = params.bufferGeometry;
        this.material = params.material;

        if (this.batchSize === 0 || this.minGroupPartSize >= this.batchSize) {
            throw new Error(`Invalid parameters: minGroupPartSize="${this.minGroupPartSize}", batchSize="${this.batchSize}"`);
        }

        this.batchesPerGroup = new Map();
        this.batches = [];
    }

    public setGroup(groupName: string, matricesList: ReadonlyArray<THREE.Matrix4>): void {
        if (this.hasGroup(groupName)) {
            this.deleteGroup(groupName);
        }

        let remainingMatricesList = matricesList.slice(0);

        const addInstancesToBatch = (batch: PropsBatch, instancesCount: number): void => {
            if (instancesCount <= 0) {
                return;
            }

            const batchMatrices = remainingMatricesList.slice(0, instancesCount);
            remainingMatricesList = remainingMatricesList.slice(instancesCount);

            batch.setInstancesGroup(groupName, batchMatrices);

            let batches = this.batchesPerGroup.get(groupName);
            if (!batches) {
                batches = new Set();
                this.batchesPerGroup.set(groupName, batches);
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
}

export { PropsHandler };
