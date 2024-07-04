import { processAsap } from '../../../../helpers/async-sync';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type IVoxelMap } from '../../i-voxelmap';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';
import {
    type VoxelsChunkData,
    type VoxelsRenderableFactoryBase,
} from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { type PatchId } from '../patch-id';

type VertexData = {
    readonly localPosition: THREE.Vector3;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

type LocalMapData = {
    readonly size: THREE.Vector3;
    readonly data: Uint16Array;
    readonly isEmpty: boolean;
};

abstract class PatchFactoryBase {
    public readonly maxPatchSize: THREE.Vector3;

    protected readonly voxelsRenderableFactory: VoxelsRenderableFactoryBase;

    protected constructor(voxelsRenderableFactory: VoxelsRenderableFactoryBase) {
        this.voxelsRenderableFactory = voxelsRenderableFactory;
        this.maxPatchSize = this.voxelsRenderableFactory.maxVoxelsChunkSize;
    }

    public async buildPatch(
        patchId: PatchId,
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        map: IVoxelMap
    ): Promise<VoxelsRenderable | null> {
        patchStart = patchStart.clone();
        patchEnd = patchEnd.clone();

        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        if (patchSize.x > this.maxPatchSize.x || patchSize.y > this.maxPatchSize.y || patchSize.z > this.maxPatchSize.z) {
            throw new Error(`Patch is too big ${vec3ToString(patchSize)} (max is ${vec3ToString(this.maxPatchSize)})`);
        }

        const voxelsRenderable = await this.queryMapAndBuildVoxelsRenderable(patchStart, patchEnd, map);
        return this.finalizePatch(voxelsRenderable, patchId, patchStart);
    }

    public async buildPatchFromVoxelsChunk(
        patchId: PatchId,
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        voxelsChunkData: VoxelsChunkData
    ): Promise<VoxelsRenderable | null> {
        patchStart = patchStart.clone();
        patchEnd = patchEnd.clone();

        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        if (patchSize.x > this.maxPatchSize.x || patchSize.y > this.maxPatchSize.y || patchSize.z > this.maxPatchSize.z) {
            throw new Error(`Patch is too big ${vec3ToString(patchSize)} (max is ${vec3ToString(this.maxPatchSize)})`);
        }

        const expectedChunkSize = patchSize.clone().addScalar(2);
        if (!voxelsChunkData.size.equals(expectedChunkSize)) {
            throw new Error(
                `Voxels chunk is not coherent with patch size: expected ${vec3ToString(expectedChunkSize)} but received ${vec3ToString(voxelsChunkData.size)}.`
            );
        }

        const voxelsRenderable = await this.voxelsRenderableFactory.buildVoxelsRenderable(voxelsChunkData);
        return this.finalizePatch(voxelsRenderable, patchId, patchStart);
    }

    public async buildVoxelsRenderable(voxelsChunkData: VoxelsChunkData): Promise<VoxelsRenderable | null> {
        return await this.voxelsRenderableFactory.buildVoxelsRenderable(voxelsChunkData);
    }

    public dispose(): void {
        this.voxelsRenderableFactory.dispose();
    }

    protected abstract queryMapAndBuildVoxelsRenderable(
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        map: IVoxelMap
    ): Promise<VoxelsRenderable | null>;

    protected static async buildLocalMapData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3, map: IVoxelMap): Promise<LocalMapData> {
        const cacheStart = patchStart.clone().subScalar(1);
        const cacheEnd = patchEnd.clone().addScalar(1);
        const cacheSize = new THREE.Vector3().subVectors(cacheEnd, cacheStart);

        const queriedLocalMapData = map.getLocalMapData(cacheStart, cacheEnd);
        return processAsap(queriedLocalMapData, localMapData => {
            const expectedCacheItemsCount = cacheSize.x * cacheSize.y * cacheSize.z;
            if (localMapData.data.length !== expectedCacheItemsCount) {
                throw new Error(
                    `Invalid cache length. Should be ${expectedCacheItemsCount} items but is ${localMapData.data.length} items`
                );
            }

            return Object.assign(localMapData, {
                size: cacheSize,
            });
        });
    }

    private finalizePatch(
        voxelsRenderable: VoxelsRenderable | null,
        patchId: PatchId,
        patchStart: THREE.Vector3Like
    ): VoxelsRenderable | null {
        if (voxelsRenderable) {
            voxelsRenderable.container.name = `Voxels patch ${patchId.asString}`;
            voxelsRenderable.container.position.set(patchStart.x, patchStart.y, patchStart.z);
            voxelsRenderable.container.updateWorldMatrix(false, true);
        }
        return voxelsRenderable;
    }
}

export { PatchFactoryBase, type LocalMapData, type VertexData };
