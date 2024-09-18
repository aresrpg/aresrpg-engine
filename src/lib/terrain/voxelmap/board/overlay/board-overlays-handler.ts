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

    private readonly board: InputBoard;

    private readonly overlaySquares: BoardOverlaySquares;
    private readonly overlayBlob: BoardOverlayBlob;

    public constructor(params: Parameters) {
        this.board = params.board;

        this.container = new THREE.Group();
        this.container.name = 'board-overlays-handler';

        this.container.position.set(this.board.origin.x, this.board.origin.y, this.board.origin.z);

        this.overlaySquares = new BoardOverlaySquares({
            size: this.board.size,
        });
        this.overlaySquares.container.position.y = 2 * BoardOverlaysHandler.yShift;
        this.container.add(this.overlaySquares.container);

        this.overlayBlob = new BoardOverlayBlob({ size: this.board.size });
        this.overlayBlob.container.position.y = 1 * BoardOverlaysHandler.yShift;
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

export { BoardOverlaysHandler };
