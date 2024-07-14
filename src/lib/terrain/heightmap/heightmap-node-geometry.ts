enum EEdgeTesselation {
    SIMPLE = 0,
    TESSELATED = 1,
}

type EdgesTesselation = {
    up: EEdgeTesselation;
    down: EEdgeTesselation;
    left: EEdgeTesselation;
    right: EEdgeTesselation;
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
    private readonly quadsCount: number;
    private readonly positionsBuffer: Float32Array;
    private readonly indexBuffers: Record<string, Indices> = {};

    public constructor(quadsCount: number) {
        this.quadsCount = quadsCount;

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

    public getIndices(edgesTesselation: EdgesTesselation): Indices {
        const cacheKey = this.buildEdgesCode(edgesTesselation);
        let result = this.indexBuffers[cacheKey];
        if (!result) {
            const indexData: number[] = [];

            const buildInnerIndex = (x: number, y: number) => 4 * 2 * this.quadsCount + x + y * (this.quadsCount - 1);
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
                edgeTesselation: EEdgeTesselation,
                edgeIndexFrom: number,
                innerIndexFrom: number,
                innerIndexStep: number,
                invert: boolean
            ) => {
                if (edgeTesselation === EEdgeTesselation.TESSELATED) {
                    for (let iEdge = 0; iEdge < 2 * this.quadsCount; iEdge += 2) {
                        const iEdgeIndex = edgeIndexFrom + iEdge;
                        const e1 = iEdgeIndex;
                        const e2 = iEdgeIndex + 1;
                        const e3 = (iEdgeIndex + 2) % (8 * this.quadsCount);

                        if (iEdge === 0 || iEdge === 2 * this.quadsCount - 2) {
                            const i1 = iEdge === 0 ? innerIndexFrom : innerIndexFrom + (this.quadsCount - 2) * innerIndexStep;
                            indexData.push(e1, e2, i1, e2, e3, i1);
                        } else {
                            const i1 = innerIndexFrom + (iEdge / 2 - 1) * innerIndexStep;
                            const i2 = i1 + innerIndexStep;
                            indexData.push(i1, e1, e2, i1, e2, i2, e2, e3, i2);
                        }
                    }
                } else {
                    for (let iEdge = 0; iEdge < 2 * this.quadsCount; iEdge += 2) {
                        const iEdgeIndex = edgeIndexFrom + iEdge;
                        const e1 = iEdgeIndex;
                        const e2 = (iEdgeIndex + 2) % (8 * this.quadsCount);

                        if (iEdge === 0 || iEdge === 2 * this.quadsCount - 2) {
                            const i1 = iEdge === 0 ? innerIndexFrom : innerIndexFrom + (this.quadsCount - 2) * innerIndexStep;
                            indexData.push(e1, e2, i1);
                        } else {
                            const i1 = innerIndexFrom + (iEdge / 2) * innerIndexStep;
                            const i2 = i1 - innerIndexStep;

                            if (invert) {
                                indexData.push(i2, e1, e2, e2, i1, i2);
                            } else {
                                indexData.push(e1, e2, i1, e1, i1, i2);
                            }
                        }
                    }
                }

                const edgeIndices: number[] = [];
                for (let iEdge = 0; iEdge <= 2 * this.quadsCount; iEdge++) {
                    const iEdgeIndex = (edgeIndexFrom + iEdge) % (8 * this.quadsCount);
                    edgeIndices.push(iEdgeIndex);
                }
                return edgeIndices;
            };

            const mpIndex = 0 * (2 * this.quadsCount);
            const ppIndex = 1 * (2 * this.quadsCount);
            const pmIndex = 2 * (2 * this.quadsCount);
            const mmIndex = 3 * (2 * this.quadsCount);

            const up = buildEdge(edgesTesselation.up, mpIndex, buildInnerIndex(0, this.quadsCount - 2), 1, true);
            const right = buildEdge(
                edgesTesselation.right,
                ppIndex,
                buildInnerIndex(this.quadsCount - 2, this.quadsCount - 2),
                -(this.quadsCount - 1),
                false
            );
            const down = buildEdge(edgesTesselation.down, pmIndex, buildInnerIndex(this.quadsCount - 2, 0), -1, true);
            const left = buildEdge(edgesTesselation.left, mmIndex, buildInnerIndex(0, 0), this.quadsCount - 1, false);

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

    private buildEdgesCode(edgesTesselation: EdgesTesselation): string {
        return `${edgesTesselation.up}_${edgesTesselation.down}_${edgesTesselation.left}_${edgesTesselation.right}`;
    }
}

export { EEdgeTesselation, HeightmapNodeGeometry, type EdgesTesselation, type Indices };
