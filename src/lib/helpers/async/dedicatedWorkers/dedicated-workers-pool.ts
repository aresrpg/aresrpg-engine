import { DedicatedWorker, type TaskProcessor, type WorkerDefinition } from './dedicated-worker';

class DedicatedWorkersPool {
    private readonly name: string;
    public readonly pooledWorkers: DedicatedWorker[] = [];

    public constructor(name: string, poolSize: number, workerDefinition: WorkerDefinition) {
        this.name = name;

        for (let i = 0; i < poolSize; i++) {
            const worker = new DedicatedWorker(`${name} (${i})`, workerDefinition);
            this.pooledWorkers.push(worker);
        }
    }

    public submitTask<T>(taskName: string, taskInput: unknown, transfer?: Transferable[]): Promise<T> {
        const worker = this.findLessBusyWorker();
        if (!worker) {
            throw new Error(`No available worker in pool "${this.name}".`);
        }
        return worker.submitTask<T>(taskName, taskInput, transfer);
    }

    public dispose(): void {
        for (const pooledWorker of this.pooledWorkers) {
            pooledWorker.dispose();
        }
        this.pooledWorkers.length = 0;
    }

    private findLessBusyWorker(): DedicatedWorker | null {
        let result: DedicatedWorker | null = null;

        let minPendingTasksCount = Number.MAX_VALUE;
        for (const worker of this.pooledWorkers) {
            const workerPendingTasksCount = worker.pendingTasksCount;
            if (workerPendingTasksCount < minPendingTasksCount) {
                result = worker;
                minPendingTasksCount = workerPendingTasksCount;
            }
        }

        return result;
    }
}

export { DedicatedWorkersPool, type TaskProcessor };
