import * as THREE from '../../../libs/three-usage';

enum EEdgeResolution {
    SIMPLE = 0,
    DECIMATED = 1,
}

type EdgesResolution = {
    readonly up: EEdgeResolution;
    readonly down: EEdgeResolution;
    readonly left: EEdgeResolution;
    readonly right: EEdgeResolution;
};

function buildEdgesResolutionId(edgesResolution: EdgesResolution): string {
    return `${edgesResolution.up}_${edgesResolution.down}_${edgesResolution.left}_${edgesResolution.right}`;
}

type Parameters = {
    readonly segmentsCount: number;
    readonly altitude: {
        readonly min: number;
        readonly max: number;
    };
};

class TileGeometryStore {
    public readonly segmentsCount: number;

    private readonly bufferGeometries: Map<string, THREE.BufferGeometry>;

    public constructor(params: Parameters) {
        if (!Number.isInteger(params.segmentsCount)) {
            throw new Error();
        }

        this.segmentsCount = params.segmentsCount;

        const positions: number[] = [];
        for (let iZ = params.segmentsCount; iZ >= 0; iZ--) {
            for (let iX = 0; iX <= params.segmentsCount; iX++) {
                positions.push(iX / params.segmentsCount, 0, iZ / params.segmentsCount);
            }
        }
        const positionsBufferAttribute = new THREE.Float32BufferAttribute(positions, 3);
        this.bufferGeometries = new Map();
        const edgesTypesList = [EEdgeResolution.SIMPLE, EEdgeResolution.DECIMATED];
        for (const up of edgesTypesList) {
            for (const down of edgesTypesList) {
                for (const left of edgesTypesList) {
                    for (const right of edgesTypesList) {
                        const edgesResolution = { up, down, left, right };
                        const bufferGeometry = new THREE.BufferGeometry();
                        bufferGeometry.setAttribute('position', positionsBufferAttribute);
                        bufferGeometry.setIndex(TileGeometryStore.getIndices(params.segmentsCount, edgesResolution));

                        const boundingBox = new THREE.Box3(
                            new THREE.Vector3(0, params.altitude.min, 0),
                            new THREE.Vector3(1, params.altitude.max, 1)
                        );
                        bufferGeometry.boundingBox = boundingBox;
                        bufferGeometry.boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());

                        const id = buildEdgesResolutionId(edgesResolution);
                        this.bufferGeometries.set(id, bufferGeometry);
                    }
                }
            }
        }
    }

    public getBufferGeometry(edgesResolution: EdgesResolution): THREE.BufferGeometry {
        const id = buildEdgesResolutionId(edgesResolution);
        const result = this.bufferGeometries.get(id);
        if (!result) {
            throw new Error();
        }
        return result;
    }

    public getBaseTile(): THREE.BufferGeometry {
        return this.getBufferGeometry({
            up: EEdgeResolution.SIMPLE,
            down: EEdgeResolution.SIMPLE,
            left: EEdgeResolution.SIMPLE,
            right: EEdgeResolution.SIMPLE,
        });
    }

    public dispose(): void {
        for (const bufferGeometry of this.bufferGeometries.values()) {
            bufferGeometry.dispose();
        }
        this.bufferGeometries.clear();
    }

    private static getIndices(segmentsCount: number, edgesResolution: EdgesResolution): number[] {
        const indexData: number[] = [];

        const buildInnerIndex = (x: number, y: number) => x + 1 + (segmentsCount - 2 - y + 1) * (segmentsCount + 1);
        for (let iX = 0; iX < segmentsCount - 2; iX++) {
            for (let iY = 0; iY < segmentsCount - 2; iY++) {
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
            for (let iEdge = 0; iEdge <= segmentsCount; iEdge++) {
                const iEdgeIndex = edgeIndexFrom + iEdge * edgeIndexStep; // % (4 * segmentsCount);
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
                    } else if (iEdge === segmentsCount - 1) {
                        const i1 = innerIndexFrom + (segmentsCount - 2) * innerIndexStep;
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
        const ppIndex = segmentsCount;
        const pmIndex = (segmentsCount + 1) * (segmentsCount + 1) - 1;
        const mmIndex = pmIndex - segmentsCount;

        // up
        buildEdge(edgesResolution.up, mpIndex, 1, buildInnerIndex(0, segmentsCount - 2), 1, true);
        // right
        buildEdge(
            edgesResolution.right,
            ppIndex,
            segmentsCount + 1,
            buildInnerIndex(segmentsCount - 2, segmentsCount - 2),
            segmentsCount + 1,
            false
        );
        // down
        buildEdge(edgesResolution.down, pmIndex, -1, buildInnerIndex(segmentsCount - 2, 0), -1, true);
        // left
        buildEdge(edgesResolution.left, mmIndex, -(segmentsCount + 1), buildInnerIndex(0, 0), -(segmentsCount + 1), false);

        return indexData;
    }
}

export { buildEdgesResolutionId, EEdgeResolution, TileGeometryStore, type EdgesResolution };
