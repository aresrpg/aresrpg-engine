type Func<T> = () => T;

class CachedItem<T> {
    private readonly evaluator: Func<T>;

    private cachedValue: { value: T } | null = null;

    public constructor(evaluator: Func<T>) {
        this.evaluator = evaluator;
    }

    public get value(): T {
        let cachedValue = this.cachedValue;
        if (!cachedValue) {
            cachedValue = {
                value: this.evaluator(),
            };
            this.cachedValue = cachedValue;
        }
        return cachedValue.value;
    }

    public invalidate(): void {
        this.cachedValue = null;
    }
}

export { CachedItem };
