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

    public start(): void {
        if (this.run) {
            throw new Error('Task is already started.');
        }

        this.run = {
            state: 'STARTED',
            promise: this.starter(),
        };
        this.run.promise.then(result => {
            if (this.run?.state !== 'STARTED') {
                throw new Error('Task is in invalid state');
            }
            this.run = {
                state: 'FINISHED',
                result,
            };
        });
    }

    public get isStarted(): boolean {
        return !!this.run;
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

    public async awaitResult(): Promise<T> {
        if (!this.run) {
            throw new Error('Task is not started.');
        } else if (this.run.state === 'STARTED') {
            return await this.run.promise;
        }
        return this.run.result;
    }
}

export { AsyncTask };
