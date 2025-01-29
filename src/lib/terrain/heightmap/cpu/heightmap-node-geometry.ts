enum EEdgeResolution {
    SIMPLE = 0,
    DECIMATED = 1,
}

type EdgesResolution = {
    up: EEdgeResolution;
    down: EEdgeResolution;
    left: EEdgeResolution;
    right: EEdgeResolution;
};

type Indices = {
    buffer: number[];
    readonly corners: {
        readonly upLeft: number;
        readonly upRight: number;
        readonly downLeft: number;
        readonly downRight: number;
    };
    readonly edges: {
        readonly up: ReadonlyArray<number>;
        readonly down: ReadonlyArray<number>;
        readonly left: ReadonlyArray<number>;
        readonly right: ReadonlyArray<number>;
    };
};

class HeightmapNodeGeometry {
    public readonly baseScaling: number;

    private readonly quadsCount: number;
    private readonly positionsBuffer: Float32Array;
    private readonly indexBuffers: Record<string, Indices> = {};

    public constructor(baseSize: number, step: number) {
        this.quadsCount = baseSize / step;
        this.baseScaling = step;

        const positions: number[] = [];
        for (let iZ = this.quadsCount; iZ >= 0; iZ--) {
            for (let iX = 0; iX <= this.quadsCount; iX++) {
                positions.push(iX, 0, iZ);
            }
        }
        this.positionsBuffer = new Float32Array(positions);
    }

    public clonePositionsBuffer(): Float32Array {
        return new Float32Array(this.positionsBuffer);
    }

    public getIndices(edgesResolution: EdgesResolution): Indices {
        const cacheKey = this.buildEdgesCode(edgesResolution);
        let result = this.indexBuffers[cacheKey];
        if (!result) {
            const indexData: number[] = [];

            const buildInnerIndex = (x: number, y: number) => x + 1 + (this.quadsCount - 2 - y + 1) * (this.quadsCount + 1);
            for (let iX = 0; iX < this.quadsCount - 2; iX++) {
                for (let iY = 0; iY < this.quadsCount - 2; iY++) {
                    const mm = buildInnerIndex(iX + 0, iY + 0);
                    const mp = buildInnerIndex(iX + 0, iY + 1);
                    const pm = buildInnerIndex(iX + 1, iY + 0);
                    const pp = buildInnerIndex(iX + 1, iY + 1);
                    indexData.push(mm, pp, pm, mm, mp, pp);
                }
            }

            const buildEdge = (
                edgeResolution: EEdgeResolution,
                edgeIndexFrom: number,
                edgeIndexStep: number,
                innerIndexFrom: number,
                innerIndexStep: number,
                invert: boolean
            ) => {
                const edgeIndices: number[] = [];
                for (let iEdge = 0; iEdge <= this.quadsCount; iEdge++) {
                    const iEdgeIndex = edgeIndexFrom + iEdge * edgeIndexStep; // % (4 * this.quadsCount);
                    edgeIndices.push(iEdgeIndex);
                }

                if (edgeResolution === EEdgeResolution.DECIMATED) {
                    for (let iEdge = 0; iEdge < edgeIndices.length - 2; iEdge += 2) {
                        const iEdgeIndex = edgeIndexFrom + iEdge * edgeIndexStep;
                        const e1 = iEdgeIndex;
                        const e2 = iEdgeIndex + 2 * edgeIndexStep;

                        if (iEdge === 0) {
                            const i1 = innerIndexFrom;
                            indexData.push(e1, e2, i1);
                        } else {
                            const i1 = innerIndexFrom + (iEdge - 2) * innerIndexStep;
                            const i2 = i1 + innerIndexStep;
                            const i3 = i2 + innerIndexStep;
                            indexData.push(i1, e1, i2, i2, e1, i3);
                            indexData.push(e1, e2, i3);
                        }
                    }
                } else {
                    for (let iEdge = 0; iEdge < edgeIndices.length - 1; iEdge++) {
                        const edgeIndex = edgeIndices[iEdge]!;
                        const e1 = edgeIndex;
                        const e2 = edgeIndex + edgeIndexStep;

                        if (iEdge === 0) {
                            const i1 = innerIndexFrom;
                            indexData.push(e1, e2, i1);
                        } else if (iEdge === this.quadsCount - 1) {
                            const i1 = innerIndexFrom + (this.quadsCount - 2) * innerIndexStep;
                            indexData.push(e1, e2, i1);
                        } else {
                            const i1 = innerIndexFrom + (iEdge - 1) * innerIndexStep;
                            const i2 = i1 + innerIndexStep;

                            if (invert) {
                                indexData.push(i1, e1, e2, e2, i2, i1);
                            } else {
                                indexData.push(i2, i1, e1, e1, e2, i2);
                            }
                        }
                    }
                }

                return edgeIndices;
            };

            const mpIndex = 0;
            const ppIndex = this.quadsCount;
            const pmIndex = (this.quadsCount + 1) * (this.quadsCount + 1) - 1;
            const mmIndex = pmIndex - this.quadsCount;

            const up = buildEdge(edgesResolution.up, mpIndex, 1, buildInnerIndex(0, this.quadsCount - 2), 1, true);
            const right = buildEdge(
                edgesResolution.right,
                ppIndex,
                this.quadsCount + 1,
                buildInnerIndex(this.quadsCount - 2, this.quadsCount - 2),
                this.quadsCount + 1,
                false
            );
            const down = buildEdge(edgesResolution.down, pmIndex, -1, buildInnerIndex(this.quadsCount - 2, 0), -1, true);
            const left = buildEdge(
                edgesResolution.left,
                mmIndex,
                -(this.quadsCount + 1),
                buildInnerIndex(0, 0),
                -(this.quadsCount + 1),
                false
            );

            result = {
                buffer: indexData.slice(0),
                corners: {
                    upLeft: mpIndex,
                    upRight: ppIndex,
                    downRight: pmIndex,
                    downLeft: mmIndex,
                },
                edges: { up, right, down, left },
            };
            this.indexBuffers[cacheKey] = result;
        }

        return {
            buffer: result.buffer.slice(0),
            corners: result.corners,
            edges: result.edges,
        };
    }

    private buildEdgesCode(edgesResolution: EdgesResolution): string {
        return `${edgesResolution.up}_${edgesResolution.down}_${edgesResolution.left}_${edgesResolution.right}`;
    }
}

export { EEdgeResolution, HeightmapNodeGeometry, type EdgesResolution, type Indices };
