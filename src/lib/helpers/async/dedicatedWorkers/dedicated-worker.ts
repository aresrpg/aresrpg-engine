type TaskOutput = {
    taskResult: any;
    taskResultTransferablesList: Transferable[];
};
type TaskProcessor = (input: any) => TaskOutput;

type WorkerDefinition = {
    readonly commonCode?: string;
    readonly tasks: Record<string, TaskProcessor>;
};

type TaskRequestMessage = {
    readonly taskName: string;
    readonly taskInput: any;
    readonly taskId: string;
};
type TaskResponseMessage =
    | {
          readonly verb: 'task_unknown';
          readonly reason: string;
      }
    | {
          readonly verb: 'task_response_ko';
          readonly taskName: string;
          readonly taskId: string;
          readonly reason: string;
      }
    | {
          readonly verb: 'task_response_ok';
          readonly taskName: string;
          readonly taskId: string;
          readonly taskResult: any;
      };

type PendingTask = {
    resolve(result: unknown): void;
    reject(reason: string): void;
};

type TaskType = {
    nextAvailableId: number;
    readonly pendingTasks: Record<string, PendingTask>;
};

class DedicatedWorker {
    private worker: Worker | null;

    private taskTypes: Record<string, TaskType>;

    public constructor(name: string, definition: WorkerDefinition) {
        this.taskTypes = {};
        for (const taskName of Object.keys(definition.tasks)) {
            this.taskTypes[taskName] = {
                nextAvailableId: 0,
                pendingTasks: {},
            };
        }

        const workerCode = DedicatedWorker.buildWorkerCode(definition);
        const blob = new Blob([workerCode], { type: 'text/javascript' });
        const objectUrl = window.URL.createObjectURL(blob);
        this.worker = new Worker(objectUrl, { name });

        this.worker.onerror = event => {
            throw new Error(`Unhandled error in DedicatedWorker "${name}":\n${event.message}`);
        };
        this.worker.onmessage = (event: MessageEvent<TaskResponseMessage>) => {
            const verb = event.data.verb;
            if (verb === 'task_unknown') {
                throw new Error(`Unknown taskname: ${JSON.stringify(event)}`);
            } else if (verb === 'task_response_ok') {
                const taskName = event.data.taskName;
                const taskId = event.data.taskId;
                const taskResult = event.data.taskResult;

                const taskType = this.taskTypes[taskName];
                if (!taskType) {
                    throw new Error(`Unknown task "${taskName}".`);
                }
                const pendingTask = taskType.pendingTasks[taskId];
                if (!pendingTask) {
                    throw new Error(`No pending task of type "${taskName}" with id "${taskId}".`);
                }
                delete taskType.pendingTasks[taskId];
                pendingTask.resolve(taskResult);
            } else if (verb === 'task_response_ko') {
                const taskName = event.data.taskName;
                const taskId = event.data.taskId;
                const reason = event.data.reason;

                const taskType = this.taskTypes[taskName];
                if (!taskType) {
                    throw new Error(`Unknown task "${taskName}".`);
                }
                const pendingTask = taskType.pendingTasks[taskId];
                if (!pendingTask) {
                    throw new Error(`No pending task of type "${taskName}" with id "${taskId}".`);
                }
                delete taskType.pendingTasks[taskId];
                pendingTask.reject(reason);
            } else {
                throw new Error(`Unknown verb "${verb}": ${JSON.stringify(event)}`);
            }
        };
    }

    public submitTask<T>(taskName: string, taskInput: unknown): Promise<T> {
        if (!this.worker) {
            throw new Error('Worker has been terminated.');
        }

        const taskType = this.taskTypes[taskName];
        if (!taskType) {
            throw new Error(`Unknown task "${taskName}".`);
        }

        const worker = this.worker;
        return new Promise<T>((resolve, reject) => {
            const taskId = `${taskName}_${taskType.nextAvailableId++}`;

            if (typeof taskType.pendingTasks[taskId] !== 'undefined') {
                throw new Error(`A task of type "${taskName}" with id "${taskId}" already exists.`);
            }
            taskType.pendingTasks[taskId] = { resolve, reject };

            const taskRequestMessage: TaskRequestMessage = {
                taskName,
                taskInput,
                taskId,
            };
            worker.postMessage(taskRequestMessage);
        });
    }

    public dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    private static buildWorkerCode(definition: WorkerDefinition): string {
        const onWorkerMessage = (event: MessageEvent<TaskRequestMessage>) => {
            const eventData = event.data;
            const taskName = eventData.taskName;
            const taskInput = eventData.taskInput;
            const taskId = eventData.taskId;

            const postResponse = (response: TaskResponseMessage, transferablesList?: Transferable[]) => {
                const transfer = transferablesList || [];
                self.postMessage(response, { transfer });
            };

            // eslint-disable-next-line no-eval
            const taskProcessorsList = eval('taskProcessors') as Record<string, TaskProcessor>;
            const taskProcessor = taskProcessorsList[taskName];
            if (typeof taskProcessor === 'undefined') {
                postResponse({
                    verb: 'task_unknown',
                    reason: `Unknown task "${taskName}"`,
                });
                return;
            }

            try {
                const taskOutput = taskProcessor(taskInput);
                postResponse(
                    {
                        verb: 'task_response_ok',
                        taskName,
                        taskId,
                        taskResult: taskOutput.taskResult,
                    },
                    taskOutput.taskResultTransferablesList
                );
            } catch (error) {
                postResponse({
                    verb: 'task_response_ko',
                    taskName,
                    taskId,
                    reason: `Exception "${error}"`,
                });
            }
        };

        return `
${definition.commonCode || ''}

const taskProcessors = {
    ${Object.entries(definition.tasks)
        .map(([taskName, taskProcessor]) => `${taskName}: ${taskProcessor},`)
        .join('\n\t')}
};

self.onmessage = ${onWorkerMessage.toString()};
`;
    }
}

export { DedicatedWorker, type TaskProcessor, type WorkerDefinition };
