import * as THREE from '../../../../libs/three-usage';
import { type Board } from '../board';
import { type GridCoord } from '../overlay/board-overlay';
import { BoardOverlayBlob } from '../overlay/board-overlay-blob';
import { BoardOverlaySquares } from '../overlay/board-overlay-squares';

type Parameters = {
    readonly board: Board;
};
class BoardHandler {
    private static readonly yShift = 0.001;

    public readonly container: THREE.Object3D;

    private readonly board: Board;

    private readonly overlaySquares: BoardOverlaySquares;
    private readonly overlayBlob: BoardOverlayBlob;

    public constructor(params: Parameters) {
        this.board = params.board;

        this.container = new THREE.Group();
        this.container.name = 'board-handler';

        this.container.position.set(this.board.origin.x, this.board.origin.y, this.board.origin.z);

        this.overlaySquares = new BoardOverlaySquares({
            size: this.board.size,
        });
        this.overlaySquares.container.position.y = 2 * BoardHandler.yShift;
        this.container.add(this.overlaySquares.container);

        this.overlayBlob = new BoardOverlayBlob({ size: this.board.size });
        this.overlayBlob.container.position.y = 1 * BoardHandler.yShift;
        this.container.add(this.overlayBlob.container);
    }

    public clearSquares(): void {
        this.overlaySquares.clear();
    }

    public displaySquares(coords: GridCoord[], color: THREE.Color, alpha: number = 1): void {
        for (const cell of coords) {
            this.overlaySquares.enableCell(cell, color, alpha);
        }
    }

    public clearAllBlobs(): void {
        this.overlayBlob.clearAll();
    }

    public clearBlob(blobId: number): void {
        this.overlayBlob.clear(blobId);
    }

    public displayBlob(blobId: number, coords: GridCoord[], color: THREE.Color, alpha: number): void {
        this.overlayBlob.setColor(blobId, color);
        this.overlayBlob.setAlpha(blobId, alpha);

        for (const cell of coords) {
            this.overlayBlob.enableCell(blobId, cell);
        }
    }

    public dispose(): void {
        this.overlayBlob.dispose();
    }
}

export { BoardHandler };
