type PromiseBuilder<T> = () => Promise<T>;

type PendingRun<T> = {
    readonly promiseBuilder: PromiseBuilder<T>;
    readonly resolve: (value: T | PromiseLike<T>) => void;
};

class PromiseThrottler {
    private readonly maxConcurrentPromises: number;

    private runningPromisesCount = 0;
    private pendingRuns: PendingRun<unknown>[] = [];

    public constructor(maxConcurrentPromises: number) {
        if (maxConcurrentPromises <= 0) {
            throw new Error();
        }
        this.maxConcurrentPromises = maxConcurrentPromises;
    }

    public async run<T>(func: PromiseBuilder<T>): Promise<T> {
        if (this.runningPromisesCount < this.maxConcurrentPromises) {
            return this.startRun(func);
        } else {
            return new Promise<T>(resolve => {
                const pendingRun: PendingRun<T> = {
                    promiseBuilder: func,
                    resolve,
                };
                this.pendingRuns.push(pendingRun as PendingRun<unknown>);
            });
        }
    }

    public cancelAll(): void {
        this.pendingRuns = [];
    }

    private startRun<T>(promiseBuilder: PromiseBuilder<T>, resolve?: (value: T | PromiseLike<T>) => void): Promise<T> {
        this.runningPromisesCount++;
        const onPromiseEnd = () => {
            this.runningPromisesCount--;

            const nextPendingRun = this.pendingRuns.shift();
            if (nextPendingRun) {
                this.startRun(nextPendingRun.promiseBuilder, nextPendingRun.resolve);
            }
        };

        const promise = promiseBuilder();
        promise.then(onPromiseEnd).catch(onPromiseEnd);

        if (resolve) {
            promise.then(resolve);
        }

        return promise;
    }
}

export { PromiseThrottler };
