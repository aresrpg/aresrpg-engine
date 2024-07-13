class Geometry {
    private readonly positionsBuffer: Float32Array;

    public constructor(quadsCount: number) {
        const positions: number[] = [];
        for (let i = 0; i <= quadsCount; i += 0.5) {
            // top edge
            positions.push(i, 0, quadsCount);
        }
        for (let i = quadsCount - 0.5; i >= 0; i -= 0.5) {
            // right edge
            positions.push(quadsCount, 0, i);
        }
        for (let i = quadsCount - 0.5; i >= 0; i -= 0.5) {
            // bottom edge
            positions.push(i, 0, 0);
        }
        for (let i = 0.5; i < quadsCount; i += 0.5) {
            // left edge
            positions.push(0, 0, i);
        }
        for (let iZ = 1; iZ <= quadsCount - 1; iZ++) {
            for (let iX = 1; iX <= quadsCount - 1; iX++) {
                positions.push(iX, 0, iZ);
            }
        }
        this.positionsBuffer = new Float32Array(positions);
    }

    public clonePositionsBuffer(): Float32Array {
        return new Float32Array(this.positionsBuffer);
    }
}

export {
    Geometry
};

