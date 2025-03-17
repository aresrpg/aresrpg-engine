import { type WorkerDefinition } from '../../../helpers/async/dedicatedWorkers/dedicated-worker';
import { DedicatedWorkersPool } from '../../../helpers/async/dedicatedWorkers/dedicated-workers-pool';

import { type ChunkClutterRaw, type ChunkClutterRawComputationInput, ClutterComputer } from './clutter-computer';

type Params = {
    readonly workersPoolSize: number;
};

class ClutterComputerWorker extends ClutterComputer {
    public readonly workersPoolSize: number;
    private workersPool: DedicatedWorkersPool | null = null;

    public constructor(params: Params) {
        super();

        this.workersPoolSize = params.workersPoolSize;
    }

    protected override computeChunkClutterRaw(input: ChunkClutterRawComputationInput): Promise<ChunkClutterRaw> {
        if (!this.workersPool) {
            const workerDefinition: WorkerDefinition = {
                commonCode: `self.factory = ${this.serialize()};`,
                tasks: {
                    computeChunkClutterRaw: (taskInput: ChunkClutterRawComputationInput) => {
                        type WorkerGlobalScope = {
                            readonly factory: ClutterComputer['serializableFactory'];
                        };
                        const factory = (self as unknown as WorkerGlobalScope).factory;
                        const taskResult = factory.computeChunkClutterRaw(taskInput);
                        const taskResultTransferablesList = Object.values(taskResult).map(arrayBuffer => arrayBuffer.buffer);
                        return {
                            taskResult,
                            taskResultTransferablesList,
                        };
                    },
                },
            };

            this.workersPool = new DedicatedWorkersPool('clutter-cpu-worker', this.workersPoolSize, workerDefinition);
        }

        return this.workersPool.submitTask('computeChunkClutterRaw', input);
    }
}

export { ClutterComputerWorker };
