interface Disposable {
    dispose(): void;
}

class DisposableStore<T extends Disposable> {
    private readonly store: Record<string, T> = {};

    public getItem(objectId: string): T | null {
        const object = this.store[objectId];
        if (object) {
            return object;
        }
        return null;
    }

    public setItem(objectId: string, object: T): void {
        this.store[objectId] = object;
    }

    public deleteItem(objectId: string): boolean {
        const object = this.store[objectId];
        if (object) {
            object.dispose();
            delete this.store[objectId];
            return true;
        }
        return false;
    }

    public clear(): void {
        for (const [objectId, object] of Object.entries(this.store)) {
            object.dispose();
            delete this.store[objectId];
        }
    }

    public getAllItems(): T[] {
        return Object.values(this.store);
    }
}

export { DisposableStore };
