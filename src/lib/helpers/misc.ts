function copyMap<T, U>(source: ReadonlyMap<T, U>, destination: Map<T, U>): void {
    destination.clear();
    for (const [key, value] of source.entries()) {
        destination.set(key, value);
    }
}

export {
    copyMap
};

