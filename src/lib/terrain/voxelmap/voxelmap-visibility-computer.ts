import * as THREE from 'three';

import { PatchId } from './patch/patch-id';

type RequestedPatch = {
    readonly id: PatchId;
    priority: number;
};

class VoxelmapVisibilityComputer {
    private readonly chunkSize: THREE.Vector3Like;
    public readonly minPatchIdY: number;
    public readonly maxPatchIdY: number;

    private requestedPatches: Record<string, RequestedPatch> = {};

    public constructor(chunkSize: THREE.Vector3Like, minAltitude: number, maxAltitude: number) {
        this.chunkSize = new THREE.Vector3().copy(chunkSize);
        this.minPatchIdY = Math.floor(minAltitude / this.chunkSize.y);
        this.maxPatchIdY = Math.floor(maxAltitude / this.chunkSize.y);
    }

    public reset(): void {
        this.requestedPatches = {};
    }

    public showMapPortion(box: THREE.Box3): void {
        const patchIdFrom = box.min.divide(this.chunkSize).floor();
        const patchIdTo = box.max.divide(this.chunkSize).ceil();

        patchIdFrom.y = Math.max(patchIdFrom.y, this.minPatchIdY);
        patchIdTo.y = Math.min(patchIdTo.y, this.maxPatchIdY);

        const iPatchId = new THREE.Vector3();
        for (iPatchId.x = patchIdFrom.x; iPatchId.x < patchIdTo.x; iPatchId.x++) {
            for (iPatchId.y = patchIdFrom.y; iPatchId.y < patchIdTo.y; iPatchId.y++) {
                for (iPatchId.z = patchIdFrom.z; iPatchId.z < patchIdTo.z; iPatchId.z++) {
                    const patchId = new PatchId(iPatchId);
                    this.addPriority(patchId, 1);
                }
            }
        }
    }

    public showMapAroundPosition(position: THREE.Vector3Like, radius: number): void {
        position = new THREE.Vector3().copy(position);
        const voxelFrom = new THREE.Vector3().copy(position).subScalar(radius);
        const voxelTo = new THREE.Vector3().copy(position).addScalar(radius);
        const patchIdFrom = voxelFrom.divide(this.chunkSize).floor();
        const patchIdTo = voxelTo.divide(this.chunkSize).floor();
        const patchIdCenter = new THREE.Vector3().copy(position).divide(this.chunkSize).floor();

        const visibilitySphere = new THREE.Sphere(new THREE.Vector3().copy(position), radius);

        const positionXZ = new THREE.Vector2(position.x, position.z);
        const patchCenterXZ = new THREE.Vector2();
        const boundingBox = new THREE.Box3();
        const iPatchId = new THREE.Vector3();
        for (iPatchId.x = patchIdFrom.x; iPatchId.x <= patchIdTo.x; iPatchId.x++) {
            for (iPatchId.z = patchIdFrom.z; iPatchId.z <= patchIdTo.z; iPatchId.z++) {
                iPatchId.y = patchIdCenter.y;

                boundingBox.min.multiplyVectors(iPatchId, this.chunkSize);
                boundingBox.max.addVectors(boundingBox.min, this.chunkSize);
                if (visibilitySphere.intersectsBox(boundingBox)) {
                    patchCenterXZ.set((iPatchId.x + 0.5) * this.chunkSize.x, (iPatchId.z + 0.5) * this.chunkSize.z);
                    const distanceXZ = positionXZ.distanceTo(patchCenterXZ);
                    const basePriority = 1 - Math.min(1, distanceXZ / radius);

                    for (iPatchId.y = this.minPatchIdY; iPatchId.y <= this.maxPatchIdY; iPatchId.y++) {
                        const patchCenterY = iPatchId.y + 0.5 + this.chunkSize.y;
                        const distanceY = Math.abs(position.y - patchCenterY);
                        const secondaryPriority = 1 - Math.min(1, distanceY / 1000);

                        const patchId = new PatchId(iPatchId);
                        const priority = 10 * basePriority + secondaryPriority;
                        this.addPriority(patchId, priority);
                    }
                }
            }
        }
    }

    public getRequestedPatches(): Readonly<RequestedPatch>[] {
        const list = Object.values(this.requestedPatches);
        list.sort((patch1, patch2) => patch2.priority - patch1.priority);
        return list;
    }

    private addPriority(patchId: PatchId, priority: number): void {
        let requestedPatch = this.requestedPatches[patchId.asString];
        if (!requestedPatch) {
            requestedPatch = { id: patchId, priority: 0 };
            this.requestedPatches[patchId.asString] = requestedPatch;
        }
        requestedPatch.priority += priority;
    }
}

export { VoxelmapVisibilityComputer, type RequestedPatch };
