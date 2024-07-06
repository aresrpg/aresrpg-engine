import { type VoxelsChunkData } from '../../voxels-renderable-factory-base';
import { DedicatedWorkersPool } from '../../../../../../helpers/async/dedicatedWorkers/dedicated-workers-pool';
import { type IVoxelMaterial, type VoxelsChunkSize } from '../../../../i-voxelmap';
import { type WorkerDefinition } from '../../../../../../helpers/async/dedicatedWorkers/dedicated-worker';

import { VoxelsRenderableFactoryCpu } from './voxels-renderable-factory-cpu';

class VoxelsRenderableFactoryCpuWorker extends VoxelsRenderableFactoryCpu {
    public readonly workersPoolSize: number;
    private workersPool: DedicatedWorkersPool | null = null;

    public constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, maxVoxelsChunkSize: VoxelsChunkSize, workerPoolSize: number) {
        super(voxelMaterialsList, maxVoxelsChunkSize);

        this.workersPoolSize = workerPoolSize;
    }

    protected override buildBuffer(voxelsChunkData: VoxelsChunkData): Promise<Uint32Array> {
        if (!this.workersPool) {
            // just for typing
            let factory: VoxelsRenderableFactoryCpu['serializableFactory'];

            const workerDefinition: WorkerDefinition = {
                commonCode: `const factory = ${this.serialize()};`,
                tasks: {
                    buildBuffer: (voxelsChunkData: VoxelsChunkData) => {
                        const buffer = factory.buildBuffer(voxelsChunkData);
                        return {
                            taskResult: buffer,
                            taskResultTransferablesList: [buffer.buffer],
                        };
                    },
                },
            };

            this.workersPool = new DedicatedWorkersPool('voxels-renderable-cpu-worker', this.workersPoolSize, workerDefinition);
        }

        return this.workersPool.submitTask('buildBuffer', voxelsChunkData);
    }

    public override dispose(): void {
        super.dispose();
        if (this.workersPool) {
            this.workersPool.dispose();
            this.workersPool = null;
        }
    }
}

export { VoxelsRenderableFactoryCpuWorker };
