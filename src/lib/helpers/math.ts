function nextPowerOfTwo(x: number): number {
    if (x <= 0) {
        throw new Error();
    }

    let n = 1;
    while (n < 30) {
        const result = 1 << n;
        if (result >= x) {
            return result;
        }
        n++;
    }

    throw new Error();
}

export { nextPowerOfTwo };
