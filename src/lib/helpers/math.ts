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

function safeModulo(n: number, m: number): number {
    return ((n % m) + m) % m;
}

function clamp(x: number, min: number, max: number): number {
    if (x < min) {
        return min;
    } else if (x > max) {
        return max;
    }
    return x;
}

export { clamp, nextPowerOfTwo, safeModulo };
