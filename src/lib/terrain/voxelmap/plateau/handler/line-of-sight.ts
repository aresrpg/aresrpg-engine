type InputGrid = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<boolean>;
};

type Parameters = {
    readonly grid: InputGrid;
};

type GridCoord = {
    readonly x: number;
    readonly z: number;
};

type GridCell = {
    readonly viewBlocking: boolean;
    readonly x: number;
    readonly z: number;
};

type Grid = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<GridCell>;
};

type CellVisibility = 'visible' | 'hidden' | 'neutral';
type GridVisibility = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<{ x: number; z: number; visibility: CellVisibility }>;
};

type Vec2 = {
    x: number;
    z: number;
};
function distanceVec2(v1: Vec2, v2: Vec2): number {
    const delta = substractVec2(v1, v2);
    return Math.sqrt(delta.x * delta.x + delta.z * delta.z);
}
function substractVec2(v1: Vec2, v2: Vec2): Vec2 {
    return { x: v1.x - v2.x, z: v1.z - v2.z };
}
function sign(p1: Vec2, p2: Vec2, p3: Vec2): number {
    return (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
}

function isPointInTriangle(pt: Vec2, v1: Vec2, v2: Vec2, v3: Vec2): boolean {
    const d1 = sign(pt, v1, v2);
    const d2 = sign(pt, v2, v3);
    const d3 = sign(pt, v3, v1);

    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;

    return !(hasNeg && hasPos);
}

class LineOfSight {
    private readonly grid: Grid;

    public constructor(params: Parameters) {
        this.grid = {
            size: params.grid.size,
            cells: params.grid.cells.map((viewBlocking: boolean, index: number) => ({
                viewBlocking,
                x: index % params.grid.size.x,
                z: Math.floor(index / params.grid.size.x),
            })),
        };
    }

    public computeCellsVisibility(origin: GridCoord, maxDistance: number): GridVisibility {
        const result: GridVisibility = {
            size: { ...this.grid.size },
            cells: this.grid.cells.map(cell => ({
                x: cell.x,
                z: cell.z,
                visibility: distanceVec2(origin, cell) > maxDistance ? 'neutral' : 'visible',
            })),
        };

        const setCellVisilibity = (coords: GridCoord, visibility: CellVisibility) => {
            if (coords.x < 0 || coords.z < 0 || coords.x >= this.grid.size.x || coords.z >= this.grid.size.z) {
                return;
            }
            const index = coords.x + coords.z * this.grid.size.x;
            result.cells[index]!.visibility = visibility;
        };

        const viewerPosition = { x: origin.x + 0.5, z: origin.z + 0.5 };

        const applyCastShadow = (s1: Vec2, s2: Vec2, minDistance: number) => {
            const p1 = viewerPosition;
            const p2 = {
                x: viewerPosition.x + 10000 * (s1.x - viewerPosition.x),
                z: viewerPosition.z + 10000 * (s1.z - viewerPosition.z),
            };
            const p3 = {
                x: viewerPosition.x + 10000 * (s2.x - viewerPosition.x),
                z: viewerPosition.z + 10000 * (s2.z - viewerPosition.z),
            };

            for (let iZ = 0; iZ < this.grid.size.z; iZ++) {
                for (let iX = 0; iX < this.grid.size.x; iX++) {
                    const cellCenter = { x: iX + 0.5, z: iZ + 0.5 };
                    const distanceFromViewer = distanceVec2(cellCenter, viewerPosition);
                    if (distanceFromViewer >= minDistance && distanceFromViewer <= maxDistance) {
                        if (isPointInTriangle(cellCenter, p1, p2, p3)) {
                            setCellVisilibity({ x: iX, z: iZ }, 'hidden');
                        }
                    }
                }
            }
        };

        for (const cell of this.grid.cells.filter(cell => cell.viewBlocking)) {
            const cellCenter = { x: cell.x + 0.5, z: cell.z + 0.5 };
            const cellDistanceFromViewer = distanceVec2(viewerPosition, cellCenter);
            if (cellDistanceFromViewer > maxDistance) {
                continue;
            }

            const e = 0.01;
            const c1 = { x: cell.x + 0.0 + e, z: cell.z + 0.0 + e };
            const c2 = { x: cell.x + 0.0 + e, z: cell.z + 1.0 - e };
            const c3 = { x: cell.x + 1.0 - e, z: cell.z + 1.0 - e };
            const c4 = { x: cell.x + 1.0 - e, z: cell.z + 0.0 + e };

            const segments: [Vec2, Vec2][] = [
                [c1, c2],
                [c2, c3],
                [c3, c4],
                [c4, c1],
            ];
            for (const segment of segments) {
                applyCastShadow(segment[0], segment[1], cellDistanceFromViewer + 0.001);
            }
        }

        return result;
    }
}

export { LineOfSight };
