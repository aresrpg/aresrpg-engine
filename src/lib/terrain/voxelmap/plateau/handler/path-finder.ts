import { type GridCoord } from "../overlay/plateau-overlay";
import * as THREE from "../../../../three-usage";

type InputGrid = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<boolean>;
};

type Parameters = {
    readonly grid: InputGrid;
};

type GridCell = {
    readonly walkable: boolean;
    distance: number;
    readonly x: number;
    readonly z: number;
}

type Grid = {
    readonly size: GridCoord;
    readonly cells: ReadonlyArray<GridCell>;
};

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
                        for (const delta of [{ x: -1, z: 0 }, { x: +1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }]) {
                            const neighbourCoords = { x: cellCoords.x + delta.x, z: cellCoords.z + delta.z };
                            const neighbour = this.tryGetCell(neighbourCoords);
                            if (neighbour && neighbour.distance === distance - 1) {
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
            throw new Error("Distance is too big to compute.");
        }
    }

    public getReachableCells(maxDistance: number = Number.MAX_SAFE_INTEGER): GridCell[] {
        if (!this.origin) {
            throw new Error("Must specify an origin before asking for a path.");
        }

        const reachableCells: GridCell[] = this.grid.cells.filter(cell => cell.distance >= 0 && cell.distance <= maxDistance);
        return reachableCells.map(cell => ({ ...cell }));
    }

    public findPathTo(coords: GridCoord): GridCoord[] | null {
        if (!this.origin) {
            throw new Error("Must specify an origin before asking for a path.");
        }

        const targetCell = this.getCell(coords);
        if (targetCell.distance < 0) {
            // no path
            return null;
        }

        const targetToOrigin = new THREE.Vector2(coords.x, coords.z).sub({ x: this.origin.x, y: this.origin.z }).normalize();

        let lastCell = targetCell;
        const reversePath: GridCell[] = [lastCell];
        while (lastCell.distance > 0) {
            const potentialPreviousSteps: { cell: GridCell, alignment: number }[] = [];
            for (const delta of [{ x: -1, z: 0 }, { x: +1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }]) {
                const neighbour = this.tryGetCell({ x: lastCell.x + delta.x, z: lastCell.z + delta.z });
                if (neighbour && neighbour.distance === lastCell.distance - 1) {
                    const neighbourToOrigin = new THREE.Vector2(neighbour.x, neighbour.z).sub({ x: this.origin.x, y: this.origin.z }).normalize();
                    const alignment = targetToOrigin.dot(neighbourToOrigin);
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
        } catch {
        }
        return null;
    }
}

export {
    PathFinder
};

