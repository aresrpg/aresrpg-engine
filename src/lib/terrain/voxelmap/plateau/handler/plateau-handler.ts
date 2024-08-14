import * as THREE from '../../../../three-usage';
import { type GridCoord } from '../overlay/plateau-overlay';
import { PlateauOverlayBlob } from '../overlay/plateau-overlay-blob';
import { PlateauOverlaySquares } from '../overlay/plateau-overlay-squares';
import { type Plateau } from '../plateau';

type Parameters = {
    readonly plateau: Plateau;
};
class PlateauHandler {
    private static readonly yShift = 0.001;

    public readonly container: THREE.Object3D;

    private readonly plateau: Plateau;

    private readonly overlaySquares: PlateauOverlaySquares;
    private readonly overlaySpells: PlateauOverlayBlob;

    public constructor(params: Parameters) {
        this.plateau = params.plateau;

        this.container = new THREE.Group();
        this.container.name = 'plateau-handler';

        this.container.position.set(this.plateau.origin.x, this.plateau.origin.y, this.plateau.origin.z);

        this.overlaySquares = new PlateauOverlaySquares({
            size: this.plateau.size,
        });
        this.overlaySquares.container.position.y = 2 * PlateauHandler.yShift;
        this.container.add(this.overlaySquares.container);

        this.overlaySpells = new PlateauOverlayBlob({ size: this.plateau.size });
        this.overlaySpells.container.position.y = 1 * PlateauHandler.yShift;
        this.container.add(this.overlaySpells.container);
    }

    public clearSquares(): void {
        this.overlaySquares.clear();
    }

    public displaySquares(coords: GridCoord[], color: THREE.Color, alpha: number = 1): void {
        for (const cell of coords) {
            this.overlaySquares.enableCell(cell, color, alpha);
        }
    }

    public dispose(): void {
        this.overlaySpells.dispose();
    }
}

export { PlateauHandler };
