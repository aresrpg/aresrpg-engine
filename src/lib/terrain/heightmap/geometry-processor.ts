type IndexedGeometryData = {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly indices: number[];
};

type ProcessedGeometryData = {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly indices?: number[];
};

type Parameters = {
    readonly outputIndexedGeometry: boolean;
};

class GeometryProcessor {
    private readonly outputIndexedGeometry: boolean;

    public constructor(params: Parameters) {
        this.outputIndexedGeometry = params.outputIndexedGeometry;
    }

    public process(input: IndexedGeometryData): ProcessedGeometryData {
        if (this.outputIndexedGeometry) {
            return input;
        } else {
            const unindexedPositions = new Float32Array(3 * input.indices.length);
            const unindexedColors = new Float32Array(3 * input.indices.length);

            for (let indexId = 0; indexId < input.indices.length; indexId++) {
                const index = input.indices[indexId]!;
                unindexedPositions.set(input.positions.subarray(3 * index, 3 * index + 3), 3 * indexId);
                unindexedColors.set(input.colors.subarray(3 * index, 3 * index + 3), 3 * indexId);
            }

            return {
                positions: unindexedPositions,
                colors: unindexedColors,
            };
        }
    }
}

export { GeometryProcessor, type IndexedGeometryData, type ProcessedGeometryData };
