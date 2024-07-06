import { DedicatedWorker, type WorkerDefinition, type TaskProcessor } from './dedicated-worker';

type PooledDedicatedWorker = {
    readonly dedicatedWorker: DedicatedWorker;
    pendingPromisesCount: number;
};

class DedicatedWorkersPool {
    private readonly name: string;
    public readonly pooledWorkers: PooledDedicatedWorker[] = [];

    public constructor(poolSize: number, workerDefinition: WorkerDefinition) {
        this.name = workerDefinition.name;

        for (let i = 0; i < poolSize; i++) {
            this.pooledWorkers.push({
                dedicatedWorker: new DedicatedWorker(workerDefinition),
                pendingPromisesCount: 0,
            });
        }
    }

    public submitTask<T>(taskName: string, taskInput: unknown): Promise<T> {
        const worker = this.findLessBusyWorker();
        if (!worker) {
            throw new Error(`No available worker in pool "${this.name}".`);
        }

        worker.pendingPromisesCount++;
        const promise = worker.dedicatedWorker.submitTask<T>(taskName, taskInput);
        promise.finally(() => worker.pendingPromisesCount--);
        return promise;
    }

    public dispose(): void {
        for (const pooledWorker of this.pooledWorkers) {
            pooledWorker.dedicatedWorker.dispose();
        }
        this.pooledWorkers.length = 0;
    }

    private findLessBusyWorker(): PooledDedicatedWorker | null {
        let result: PooledDedicatedWorker | null = null;

        let minPendingPromisesCount = Number.MAX_VALUE;
        for (const worker of this.pooledWorkers) {
            if (worker.pendingPromisesCount < minPendingPromisesCount) {
                result = worker;
                minPendingPromisesCount = worker.pendingPromisesCount;
            }
        }

        return result;
    }
}

export { DedicatedWorkersPool, type TaskProcessor };
