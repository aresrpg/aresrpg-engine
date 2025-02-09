import * as THREE from '../../libs/three-usage';

import { ChunkId } from './chunk/chunk-id';

type RequestedChunk = {
    readonly id: ChunkId;
    priority: number;
};

class VoxelmapVisibilityComputer {
    private readonly chunkSize: THREE.Vector3Like;
    public readonly minChunkIdY: number;
    public readonly maxChunkIdY: number;

    private readonly requestedChunks = new Map<string, RequestedChunk>();

    public constructor(chunkSize: THREE.Vector3Like, minChunkIdY: number, maxChunkIdY: number) {
        this.chunkSize = new THREE.Vector3().copy(chunkSize);
        this.minChunkIdY = minChunkIdY;
        this.maxChunkIdY = maxChunkIdY;
    }

    public reset(): void {
        this.requestedChunks.clear();
    }

    public showMapPortion(box: THREE.Box3): void {
        const chunkIdFrom = box.min.divide(this.chunkSize).floor();
        const chunkIdTo = box.max.divide(this.chunkSize).ceil();

        chunkIdFrom.y = Math.max(chunkIdFrom.y, this.minChunkIdY);
        chunkIdTo.y = Math.min(chunkIdTo.y, this.maxChunkIdY);

        const iChunkId = new THREE.Vector3();
        for (iChunkId.x = chunkIdFrom.x; iChunkId.x < chunkIdTo.x; iChunkId.x++) {
            for (iChunkId.y = chunkIdFrom.y; iChunkId.y < chunkIdTo.y; iChunkId.y++) {
                for (iChunkId.z = chunkIdFrom.z; iChunkId.z < chunkIdTo.z; iChunkId.z++) {
                    const chunkId = new ChunkId(iChunkId);
                    this.addPriority(chunkId, 1);
                }
            }
        }
    }

    public showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void {
        position = new THREE.Vector3().copy(position);
        const voxelFrom = new THREE.Vector3().copy(position).subScalar(radius);
        const voxelTo = new THREE.Vector3().copy(position).addScalar(radius);
        const chunkIdFrom = voxelFrom.divide(this.chunkSize).floor();
        const chunkIdTo = voxelTo.divide(this.chunkSize).floor();
        const chunkIdCenter = new THREE.Vector3().copy(position).divide(this.chunkSize).floor();

        const visibilitySphere = new THREE.Sphere(new THREE.Vector3().copy(position), radius);

        const positionXZ = new THREE.Vector2(position.x, position.z);
        const chunkCenterXZ = new THREE.Vector2();
        const boundingBox = new THREE.Box3();
        const iChunkId = new THREE.Vector3();
        for (iChunkId.x = chunkIdFrom.x; iChunkId.x <= chunkIdTo.x; iChunkId.x++) {
            for (iChunkId.z = chunkIdFrom.z; iChunkId.z <= chunkIdTo.z; iChunkId.z++) {
                iChunkId.y = chunkIdCenter.y;

                boundingBox.min.multiplyVectors(iChunkId, this.chunkSize);
                boundingBox.max.addVectors(boundingBox.min, this.chunkSize);
                if (visibilitySphere.intersectsBox(boundingBox)) {
                    chunkCenterXZ.set((iChunkId.x + 0.5) * this.chunkSize.x, (iChunkId.z + 0.5) * this.chunkSize.z);
                    const distanceXZ = positionXZ.distanceTo(chunkCenterXZ);
                    const basePriority = 1 - Math.min(1, distanceXZ / radius);

                    for (iChunkId.y = this.minChunkIdY; iChunkId.y <= this.maxChunkIdY; iChunkId.y++) {
                        const chunkCenterY = iChunkId.y + 0.5 + this.chunkSize.y;
                        const distanceY = Math.abs(position.y - chunkCenterY);
                        const secondaryPriority = 1 - Math.min(1, distanceY / 1000);

                        const chunkId = new ChunkId(iChunkId);
                        const distancePriority = 10 * basePriority + secondaryPriority;
                        const closenessPriority = distanceXZ < 100 ? 20 : 0;
                        const visibilityPriority = frustum?.intersectsBox(boundingBox) ? 10 : 0;
                        const priority = distancePriority + closenessPriority + visibilityPriority;
                        this.addPriority(chunkId, priority);
                    }
                }
            }
        }
    }

    public getRequestedChunks(): Readonly<RequestedChunk>[] {
        const requestedChunksList = Array.from(this.requestedChunks.values());
        requestedChunksList.sort((chunk1, chunk2) => chunk2.priority - chunk1.priority);
        return requestedChunksList;
    }

    private addPriority(chunkId: ChunkId, priority: number): void {
        let requestedChunk = this.requestedChunks.get(chunkId.asString);
        if (!requestedChunk) {
            requestedChunk = { id: chunkId, priority: 0 };
            this.requestedChunks.set(chunkId.asString, requestedChunk);
        }
        requestedChunk.priority += priority;
    }
}

export { VoxelmapVisibilityComputer, type RequestedChunk };
