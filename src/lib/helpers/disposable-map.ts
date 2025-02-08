import { CachedItem } from './cached-item';

interface IDisposable {
    dispose(): void;
}

type Key = string | number;

class DisposableMap<T extends IDisposable> {
    private readonly store = new Map<Key, T>();
    private readonly itemsList = new CachedItem<T[]>(() => Object.values(this.store));

    public setItem(id: Key, item: T): void {
        this.deleteItem(id);
        this.store.set(id, item);
        this.itemsList.invalidate();
    }

    public getItem(id: Key): T | null {
        return this.store.get(id) || null;
    }

    public deleteItem(id: Key): boolean {
        const item = this.store.get(id);
        if (typeof item !== 'undefined') {
            item.dispose();
            this.store.delete(id);
            this.itemsList.invalidate();
            return true;
        }
        return false;
    }

    public get allItems(): ReadonlyArray<T> {
        return this.itemsList.value;
    }

    public get itemsCount(): number {
        return this.allItems.length;
    }

    public clear(): void {
        for (const item of this.allItems) {
            item.dispose();
        }
        this.store.clear();
        this.itemsList.invalidate();
    }
}

export { DisposableMap };
