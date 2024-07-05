type SyncOrPromise<T> = T | Promise<T>;

type Function<T, R> = (input: T) => R;

function processAsap<T, R>(input: SyncOrPromise<T>, processor: Function<T, R>): SyncOrPromise<R> {
    if (input instanceof Promise) {
        return new Promise<R>(resolve => {
            input.then(resolvedInput => {
                const result = processor(resolvedInput);
                resolve(result);
            });
        });
    } else {
        return processor(input);
    }
}

export { processAsap, type SyncOrPromise };
