interface IDisposable {
    dispose(): void;
}

class DisposableMap<T extends IDisposable> {
    private store: Record<string, T> = {};

    public setItem(id: string, item: T): void {
        this.deleteItem(id);
        this.store[id] = item;
    }

    public getItem(id: string): T | null {
        return this.store[id] || null;
    }

    public deleteItem(id: string): boolean {
        const item = this.store[id];
        if (typeof item !== 'undefined') {
            item.dispose();
            delete this.store[id];
            return true;
        }
        return false;
    }

    public get allItems(): T[] {
        return Object.values(this.store);
    }

    public clear(): void {
        for (const item of this.allItems) {
            item.dispose();
        }
        this.store = {};
    }
}

export { DisposableMap };
