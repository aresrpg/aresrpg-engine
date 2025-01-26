import { logger } from '../../logger';

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
          readonly verb: 'task_response_ko';
          readonly taskId: string;
          readonly reason: string;
      }
    | {
          readonly verb: 'task_response_ok';
          readonly taskId: string;
          readonly taskResult: any;
      };

type RequestMessage = {
    readonly messageId: number;
    readonly type: 'task_request';
    readonly taskRequestMessage: TaskRequestMessage;
};
type ResponseMessage = {
    readonly messageId: number;
    readonly type: 'task_response';
    readonly taskResponseMessage: TaskResponseMessage;
};

type PendingTask = {
    resolve(result: unknown): void;
    reject(reason: string): void;
};

type TaskType = {
    count: number;
};

class DedicatedWorker {
    private readonly name: string;
    private worker: Worker | null;

    private messagesCount: number = 0;

    private readonly taskCounters: Map<string, TaskType>;
    private readonly pendingTasks: Map<string, PendingTask>;

    public constructor(name: string, definition: WorkerDefinition) {
        this.name = name;

        this.taskCounters = new Map();
        for (const taskName of Object.keys(definition.tasks)) {
            this.taskCounters.set(taskName, { count: 0 });
        }
        this.pendingTasks = new Map();

        const workerCode = DedicatedWorker.buildWorkerCode(definition);
        const blob = new Blob([workerCode], { type: 'text/javascript' });
        const objectUrl = window.URL.createObjectURL(blob);
        this.worker = new Worker(objectUrl, { name });

        this.worker.onerror = event => {
            throw new Error(`Unhandled error in DedicatedWorker "${name}":\n${event.message}`);
        };
        this.worker.onmessage = (event: MessageEvent<ResponseMessage>) => {
            const responseMessage = event.data;
            this.onTaskResponseMessage(responseMessage.taskResponseMessage);
        };
    }

    public submitTask<T>(taskName: string, taskInput: unknown, transfer?: Transferable[]): Promise<T> {
        if (!this.worker) {
            throw new Error('Worker has been terminated.');
        }

        const taskType = this.taskCounters.get(taskName);
        if (!taskType) {
            throw new Error(`Unknown task "${taskName}".`);
        }
        const taskId = `${taskName}_${taskType.count++}`;

        const worker = this.worker;
        return new Promise<T>((resolve, reject) => {
            if (this.pendingTasks.has(taskId)) {
                throw new Error(`A task with id "${taskId}" already exists.`);
            }
            this.pendingTasks.set(taskId, { resolve, reject });

            const requestMessage: RequestMessage = {
                messageId: this.messagesCount++,
                type: 'task_request',
                taskRequestMessage: {
                    taskName,
                    taskInput,
                    taskId,
                },
            };
            worker.postMessage(requestMessage, transfer ?? []);
        });
    }

    public dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        for (const [pendingTaskId, pendingTask] of this.pendingTasks.entries()) {
            pendingTask.reject('Worker was terminated');
            logger.warn(`DedicatedWorker "${this.name}" was disposed while task "${pendingTaskId}" was pending.`);
        }
        this.pendingTasks.clear();
    }

    private onTaskResponseMessage(taskResponseMessage: TaskResponseMessage): void {
        const taskId = taskResponseMessage.taskId;
        const pendingTask = this.pendingTasks.get(taskId);
        if (!pendingTask) {
            throw new Error(`No pending task with id "${taskId}".`);
        }
        this.pendingTasks.delete(taskId);

        const verb = taskResponseMessage.verb;
        if (verb === 'task_response_ok') {
            pendingTask.resolve(taskResponseMessage.taskResult);
        } else if (verb === 'task_response_ko') {
            pendingTask.reject(taskResponseMessage.reason);
        } else {
            pendingTask.reject(`Unknown verb "${verb}"`);
            throw new Error(`Unknown verb "${verb}": ${JSON.stringify(event)}`);
        }
    }

    private static buildWorkerCode(definition: WorkerDefinition): string {
        const onWorkerMessage = (event: MessageEvent<RequestMessage>) => {
            const requestMessage = event.data;
            const messageId = requestMessage.messageId;

            type TaskProcessingResult = {
                readonly taskResponseMessage: TaskResponseMessage;
                readonly transferablesList?: Transferable[];
            };

            const processTask = (taskRequestMessage: TaskRequestMessage): TaskProcessingResult => {
                const { taskName, taskInput, taskId } = taskRequestMessage;

                try {
                    // eslint-disable-next-line no-eval
                    const taskProcessorsList = eval('taskProcessors') as Record<string, TaskProcessor>;
                    const taskProcessor = taskProcessorsList[taskName];
                    if (typeof taskProcessor === 'undefined') {
                        throw new Error(`Unknwon task "${taskName}"`);
                    }

                    const taskOutput = taskProcessor(taskInput);
                    return {
                        taskResponseMessage: {
                            verb: 'task_response_ok',
                            taskId,
                            taskResult: taskOutput.taskResult,
                        },
                        transferablesList: taskOutput.taskResultTransferablesList,
                    };
                } catch (error) {
                    return {
                        taskResponseMessage: {
                            verb: 'task_response_ko',
                            taskId,
                            reason: `Exception "${error}"`,
                        },
                    };
                }
            };

            const transferablesList: Transferable[] = [];
            const taskProcessingResult = processTask(requestMessage.taskRequestMessage);
            if (taskProcessingResult.transferablesList) {
                transferablesList.push(...taskProcessingResult.transferablesList);
            }
            const responseMessage: ResponseMessage = {
                messageId,
                type: 'task_response',
                taskResponseMessage: taskProcessingResult.taskResponseMessage,
            };
            self.postMessage(responseMessage, { transfer: transferablesList });
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
