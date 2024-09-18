import * as THREE from '../../../../libs/three-usage';

import { type GridCoord } from './board-overlay';
import { BoardOverlayBlob } from './board-overlay-blob';
import { BoardOverlaySquares } from './board-overlay-squares';

type InputBoard = {
    readonly size: { readonly x: number; readonly z: number };
    readonly origin: THREE.Vector3Like;
};

type Parameters = {
    readonly board: InputBoard;
};

class BoardOverlaysHandler {
    private static readonly yShift = 0.001;

    public readonly container: THREE.Object3D;

    private overlaySquares: BoardOverlaySquares;
    private overlayBlob: BoardOverlayBlob;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'board-overlays-handler';

        const overlays = this.buildOverlays(params.board.size);
        this.overlaySquares = overlays.squares;
        this.overlayBlob = overlays.blob;
        this.container.add(this.overlaySquares.container);
        this.container.add(this.overlayBlob.container);
        this.container.position.set(params.board.origin.x, params.board.origin.y, params.board.origin.z);
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
        this.overlaySquares.dispose();
    }

    public reset(board: InputBoard): void {
        this.overlayBlob.dispose();
        this.overlaySquares.dispose();
        this.container.clear();

        const overlays = this.buildOverlays(board.size);
        this.overlaySquares = overlays.squares;
        this.overlayBlob = overlays.blob;
        this.container.add(this.overlaySquares.container);
        this.container.add(this.overlayBlob.container);
        this.container.position.set(board.origin.x, board.origin.y, board.origin.z);
    }

    private buildOverlays(gridSize: InputBoard['size']): { squares: BoardOverlaySquares; blob: BoardOverlayBlob } {
        const squares = new BoardOverlaySquares({ size: gridSize });
        squares.container.position.y = 2 * BoardOverlaysHandler.yShift;

        const blob = new BoardOverlayBlob({ size: gridSize });
        blob.container.position.y = 1 * BoardOverlaysHandler.yShift;

        return { squares, blob };
    }
}

export { BoardOverlaysHandler };
