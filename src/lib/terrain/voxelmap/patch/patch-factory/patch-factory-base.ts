import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../libs/three-usage';
import { type VoxelsRenderable } from '../../voxelsRenderable/voxels-renderable';
import {
    type VoxelsChunkData,
    type VoxelsChunkDataNotEmpty,
    type VoxelsRenderableFactoryBase,
} from '../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { type ChunkId } from '../chunk-id';

type VertexData = {
    readonly localPosition: THREE.Vector3;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

abstract class PatchFactoryBase {
    public readonly maxPatchSize: THREE.Vector3;

    public abstract readonly maxPatchesComputedInParallel: number;

    protected readonly voxelsRenderableFactory: VoxelsRenderableFactoryBase;

    protected constructor(voxelsRenderableFactory: VoxelsRenderableFactoryBase) {
        this.voxelsRenderableFactory = voxelsRenderableFactory;
        this.maxPatchSize = this.voxelsRenderableFactory.maxVoxelsChunkSize;
    }

    public async buildPatchFromVoxelsChunk(
        chunkId: ChunkId,
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        voxelsChunkData: VoxelsChunkDataNotEmpty
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

        const buildResult = this.buildVoxelsRenderable(voxelsChunkData);
        if (buildResult === null) {
            return null;
        }
        const voxelsRenderable = await buildResult;
        if (voxelsRenderable) {
            voxelsRenderable.container.name = `voxels-patch-${chunkId.asString}`;
            voxelsRenderable.container.position.set(patchStart.x, patchStart.y, patchStart.z);
            voxelsRenderable.container.updateWorldMatrix(false, true);
            voxelsRenderable.boundingBox.translate(new THREE.Vector3().copy(patchStart));
        }
        return voxelsRenderable;
    }

    public buildVoxelsRenderable(voxelsChunkData: VoxelsChunkData): null | Promise<VoxelsRenderable | null> {
        return this.voxelsRenderableFactory.buildVoxelsRenderable(voxelsChunkData);
    }

    public dispose(): void {
        this.voxelsRenderableFactory.dispose();
    }
}

export { PatchFactoryBase, type VertexData };
