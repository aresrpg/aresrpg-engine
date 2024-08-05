import { type WorkerDefinition } from '../../../../../../helpers/async/dedicatedWorkers/dedicated-worker';
import { DedicatedWorkersPool } from '../../../../../../helpers/async/dedicatedWorkers/dedicated-workers-pool';
import { type IVoxelMaterial, type VoxelsChunkSize } from '../../../../i-voxelmap';
import { type CheckerboardType, type VoxelsChunkData } from '../../voxels-renderable-factory-base';

import { VoxelsRenderableFactoryCpu } from './voxels-renderable-factory-cpu';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly workersPoolSize: number;
    readonly isCheckerboardMode?: boolean;
    readonly checkerboardType?: CheckerboardType | undefined;
};

class VoxelsRenderableFactoryCpuWorker extends VoxelsRenderableFactoryCpu {
    public readonly workersPoolSize: number;
    protected get workersPoolName(): string {
        return 'voxels-renderable-cpu-worker';
    }

    private workersPool: DedicatedWorkersPool | null = null;

    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: params.maxVoxelsChunkSize,
            isCheckerboardMode: params.isCheckerboardMode,
            checkerboardType: params.checkerboardType,
        });

        this.workersPoolSize = params.workersPoolSize;
    }

    protected override buildBuffer(voxelsChunkData: VoxelsChunkData): Promise<Uint32Array> {
        if (!this.workersPool) {
            const workerDefinition: WorkerDefinition = {
                commonCode: `const factory = ${this.serialize()};`,
                tasks: {
                    buildBuffer: (voxelsChunkData: VoxelsChunkData) => {
                        // eslint-disable-next-line no-eval
                        const factory2 = eval('factory') as VoxelsRenderableFactoryCpu['serializableFactory'];
                        const buffer = factory2.buildBuffer(voxelsChunkData);
                        return {
                            taskResult: buffer,
                            taskResultTransferablesList: [buffer.buffer],
                        };
                    },
                },
            };

            this.workersPool = new DedicatedWorkersPool(this.workersPoolName, this.workersPoolSize, workerDefinition);
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

export { VoxelsRenderableFactoryCpuWorker, type Parameters };
