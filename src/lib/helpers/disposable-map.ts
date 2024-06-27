interface IDisposable {
    dispose(): void;
}

type Key = string | number;

class DisposableMap<T extends IDisposable> {
    private store: Record<Key, T> = {};

    public setItem(id: Key, item: T): void {
        this.deleteItem(id);
        this.store[id] = item;
    }

    public getItem(id: Key): T | null {
        return this.store[id] || null;
    }

    public deleteItem(id: Key): boolean {
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

    public get itemsCount(): number {
        return Object.keys(this.store).length;
    }

    public clear(): void {
        for (const item of this.allItems) {
            item.dispose();
        }
        this.store = {};
    }
}

export { DisposableMap };
