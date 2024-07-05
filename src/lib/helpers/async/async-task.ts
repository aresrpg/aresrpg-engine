type PromiseCreator<T> = () => Promise<T>;

class AsyncTask<T> {
    private readonly starter: PromiseCreator<T>;

    private run:
        | null
        | {
              state: 'STARTED';
              promise: Promise<T>;
          }
        | {
              state: 'FINISHED';
              result: T;
          } = null;

    public constructor(starter: PromiseCreator<T>) {
        this.starter = starter;
    }

    public start(): Promise<T> {
        return new Promise<T>(resolve => {
            if (this.run) {
                throw new Error(`AsyncTask is already started and is in state ${this.run.state}.`);
            }

            this.run = {
                state: 'STARTED',
                promise: this.starter(),
            };

            this.run.promise.then(result => {
                if (this.run?.state !== 'STARTED') {
                    throw new Error(`AsyncTask is in an invalid state (${this.run?.state}).`);
                }
                this.run = {
                    state: 'FINISHED',
                    result,
                };
                resolve(result);
            });
        });
    }

    public get isStarted(): boolean {
        return !!this.run;
    }

    public get isRunning(): boolean {
        return this.run?.state === 'STARTED';
    }

    public get isFinished(): boolean {
        return this.run?.state === 'FINISHED';
    }

    public getResultSync(): T {
        if (this.run?.state !== 'FINISHED') {
            throw new Error('Task is not finished.');
        }
        return this.run.result;
    }
}

export { AsyncTask };
