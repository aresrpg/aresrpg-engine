class Transition {
    private readonly startTimestamp: number = performance.now();

    private duration: number;
    private from: number;
    private to: number;

    public constructor(duration: number, from: number, to: number) {
        this.duration = duration;
        this.from = from;
        this.to = to;
    }

    public get currentValue(): number {
        const progress = this.progress;
        return this.from * (1 - progress) + this.to * progress;
    }

    public isFinished(): boolean {
        return this.progress === 1;
    }

    public get progress(): number {
        const progress = (performance.now() - this.startTimestamp) / this.duration;
        if (progress < 0) {
            return 0;
        } else if (progress > 1) {
            return 1;
        } else {
            return progress;
        }
    }
}

export { Transition };
