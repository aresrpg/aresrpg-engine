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
    readonly walkable: boolean;
    distance: number;
    readonly x: number;
    readonly z: number;
};

type Grid = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<GridCell>;
};

type Vec2 = {
    x: number;
    z: number;
};
function normalizeVec2(v: Vec2): Vec2 {
    const length = Math.sqrt(v.x * v.x + v.z * v.z);
    if (length === 0) {
        v.x = 0;
        v.z = 0;
    }
    v.x /= length;
    v.z /= length;
    return v;
}
function substractVec2(v1: Vec2, v2: Vec2): Vec2 {
    return { x: v1.x - v2.x, z: v1.z - v2.z };
}
function dotVec2(v1: Vec2, v2: Vec2): number {
    return v1.x * v2.x + v1.z * v2.z;
}

class PathFinder {
    private readonly grid: Grid;
    private origin: GridCoord | null = null;

    public constructor(params: Parameters) {
        this.grid = {
            size: params.grid.size,
            cells: params.grid.cells.map((walkable: boolean, index: number) => ({
                walkable,
                distance: -1,
                x: index % params.grid.size.x,
                z: Math.floor(index / params.grid.size.x),
            })),
        };
    }

    public setOrigin(coords: GridCoord): void {
        if (this.origin && this.origin.x === coords.x && this.origin.z === coords.z) {
            return;
        }

        if (!this.getCell(coords).walkable) {
            return;
        }

        this.origin = coords;

        for (const cell of this.grid.cells) {
            cell.distance = -1;
        }

        this.getCell(this.origin).distance = 0;
        const maxDistance = 150;
        let keepSearching = true;
        for (let distance = 1; distance < maxDistance && keepSearching; distance++) {
            let foundNewPath = false;

            const cellCoords = { x: 0, z: 0 };
            for (cellCoords.z = 0; cellCoords.z < this.grid.size.z; cellCoords.z++) {
                for (cellCoords.x = 0; cellCoords.x < this.grid.size.x; cellCoords.x++) {
                    const cell = this.getCell(cellCoords);
                    if (cell.walkable && cell.distance < 0) {
                        // cell has not been reached yet
                        for (const neighbour of this.getNeighbouringCells(cellCoords)) {
                            if (neighbour.distance === distance - 1) {
                                cell.distance = distance;
                                foundNewPath = true;
                                break;
                            }
                        }
                    }
                }
            }

            keepSearching = foundNewPath;
        }

        if (keepSearching) {
            throw new Error('Distance is too big to compute.');
        }
    }

    public getReachableCells(maxDistance: number = Number.MAX_SAFE_INTEGER): GridCell[] {
        if (!this.origin) {
            throw new Error('Must specify an origin before asking for a path.');
        }

        const reachableCells: GridCell[] = this.grid.cells.filter(cell => cell.distance >= 0 && cell.distance <= maxDistance);
        return reachableCells.map(cell => ({ ...cell }));
    }

    public findPathTo(coords: GridCoord): GridCoord[] | null {
        if (!this.origin) {
            throw new Error('Must specify an origin before asking for a path.');
        }

        const targetCell = this.getCell(coords);
        if (targetCell.distance < 0) {
            // no path
            return null;
        }

        const targetToOrigin = normalizeVec2(substractVec2(coords, this.origin));

        let lastCell = targetCell;
        const reversePath: GridCell[] = [lastCell];
        while (lastCell.distance > 0) {
            const potentialPreviousSteps: {
                cell: GridCell;
                alignment: number;
            }[] = [];
            for (const neighbour of this.getNeighbouringCells(lastCell)) {
                if (neighbour.distance === lastCell.distance - 1) {
                    const neighbourToOrigin = normalizeVec2(substractVec2(neighbour, this.origin));
                    const alignment = dotVec2(targetToOrigin, neighbourToOrigin);
                    potentialPreviousSteps.push({ cell: neighbour, alignment });
                }
            }

            let bestPreviousStep = potentialPreviousSteps[0];
            if (!bestPreviousStep) {
                throw new Error();
            }
            for (const potentialPreviousStep of potentialPreviousSteps) {
                if (potentialPreviousStep.alignment > bestPreviousStep.alignment) {
                    bestPreviousStep = potentialPreviousStep;
                }
            }

            reversePath.push(bestPreviousStep.cell);
            lastCell = bestPreviousStep.cell;
        }

        return reversePath.reverse().map(cell => ({ x: cell.x, z: cell.z }));
    }

    private getCell(coords: GridCoord): GridCell {
        if (coords.x < 0 || coords.z < 0 || coords.x >= this.grid.size.x || coords.z >= this.grid.size.z) {
            throw new Error(`Invalid grid coords ${coords.x}x${coords.z} (size is ${this.grid.size.x}x${this.grid.size.z})`);
        }

        return this.grid.cells[coords.x + this.grid.size.x * coords.z]!;
    }

    private tryGetCell(coords: GridCoord): GridCell | null {
        try {
            return this.getCell(coords);
        } catch {}
        return null;
    }

    private getNeighbouringCells(coords: GridCoord): GridCell[] {
        const result: GridCell[] = [];
        for (const delta of [
            { x: -1, z: 0 },
            { x: +1, z: 0 },
            { x: 0, z: -1 },
            { x: 0, z: 1 },
        ]) {
            const neighbour = this.tryGetCell({ x: coords.x + delta.x, z: coords.z + delta.z });
            if (neighbour) {
                result.push(neighbour);
            }
        }
        return result;
    }
}

export { PathFinder };
