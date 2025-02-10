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

abstract class ChunkRenderableFactoryBase {
    public readonly maxChunkSize: THREE.Vector3;

    public abstract readonly maxChunksComputedInParallel: number;

    protected readonly voxelsRenderableFactory: VoxelsRenderableFactoryBase;

    protected constructor(voxelsRenderableFactory: VoxelsRenderableFactoryBase) {
        this.voxelsRenderableFactory = voxelsRenderableFactory;
        this.maxChunkSize = this.voxelsRenderableFactory.maxVoxelsChunkSize;
    }

    public async buildChunkRenderable(
        chunkId: ChunkId,
        chunkStart: THREE.Vector3,
        chunkEnd: THREE.Vector3,
        voxelsChunkData: VoxelsChunkDataNotEmpty
    ): Promise<VoxelsRenderable | null> {
        chunkStart = chunkStart.clone();
        chunkEnd = chunkEnd.clone();

        const chunkSize = new THREE.Vector3().subVectors(chunkEnd, chunkStart);
        if (chunkSize.x > this.maxChunkSize.x || chunkSize.y > this.maxChunkSize.y || chunkSize.z > this.maxChunkSize.z) {
            throw new Error(`Chunk is too big ${vec3ToString(chunkSize)} (max is ${vec3ToString(this.maxChunkSize)})`);
        }

        const expectedChunkSize = chunkSize.clone().addScalar(2);
        if (!voxelsChunkData.size.equals(expectedChunkSize)) {
            throw new Error(
                `Voxels chunk is not coherent with chunk size: expected ${vec3ToString(expectedChunkSize)} but received ${vec3ToString(voxelsChunkData.size)}.`
            );
        }

        const buildResult = this.buildVoxelsRenderable(voxelsChunkData);
        if (buildResult === null) {
            return null;
        }
        const voxelsRenderable = await buildResult;
        if (voxelsRenderable) {
            voxelsRenderable.container.name = `voxels-chunk-${chunkId.asString}`;
            voxelsRenderable.container.position.set(chunkStart.x, chunkStart.y, chunkStart.z);
            voxelsRenderable.container.updateWorldMatrix(false, true);
            voxelsRenderable.boundingBox.translate(new THREE.Vector3().copy(chunkStart));
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

export { ChunkRenderableFactoryBase, type VertexData };
