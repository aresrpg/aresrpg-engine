import * as THREE from '../../../../three-usage';
import { type GridCoord } from '../overlay/plateau-overlay';
import { PlateauOverlayBlob } from '../overlay/plateau-overlay-blob';
import { PlateauOverlaySquares } from '../overlay/plateau-overlay-squares';
import { type Plateau } from '../plateau';

type Parameters = {
    readonly plateau: Plateau;
    readonly colors?: {
        readonly cellReachable?: THREE.Color;
        readonly path?: THREE.Color;
    };
};
class PlateauHandler {
    private static readonly yShift = 0.01;

    public readonly container: THREE.Object3D;

    private readonly plateau: Plateau;

    private readonly overlayMoves: PlateauOverlaySquares;
    private readonly overlaySpells: PlateauOverlayBlob;

    private readonly colors: {
        readonly cellReachable: THREE.Color;
        readonly path: THREE.Color;
    };

    public constructor(params: Parameters) {
        this.plateau = params.plateau;

        this.colors = {
            cellReachable: params.colors?.cellReachable ?? new THREE.Color(0x88dd88),
            path: params.colors?.path ?? new THREE.Color(0x44aa44),
        };

        this.container = new THREE.Group();
        this.container.name = 'plateau-handler';

        this.container.position.set(this.plateau.origin.x, this.plateau.origin.y, this.plateau.origin.z);

        this.overlayMoves = new PlateauOverlaySquares({
            size: this.plateau.size,
            background: {
                color: this.colors.cellReachable,
                alpha: 0.4,
            },
        });
        this.overlayMoves.container.position.y = 2 * PlateauHandler.yShift;
        this.container.add(this.overlayMoves.container);

        this.overlaySpells = new PlateauOverlayBlob({ size: this.plateau.size });
        this.overlaySpells.container.position.y = 1 * PlateauHandler.yShift;
        this.container.add(this.overlaySpells.container);
    }

    public clearPaths(): void {
        this.overlayMoves.clear();
    }

    public displayReachableCells(reachableCells: GridCoord[]): void {
        for (const cell of reachableCells) {
            this.overlayMoves.enableCell(cell, this.colors.cellReachable);
        }
    }

    public displayPath(pathCells: GridCoord[]): void {
        for (const cell of pathCells) {
            this.overlayMoves.enableCell(cell, this.colors.path);
        }
    }

    public dispose(): void {
        this.overlaySpells.dispose();
    }
}

export { PlateauHandler };
