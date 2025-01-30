import * as THREE from '../../../../libs/three-usage';

type Parameters = {
    readonly baseCellSize: number;
    readonly maxNesting: number;
};

type CellId = {
    readonly x: number;
    readonly z: number;
};
type TileCoords = CellId;
type TileId = {
    readonly nestingLevel: number;
    readonly localCoords: TileCoords; // relative to root
};

type UvChunk = {
    readonly scale: number;
    readonly shift: THREE.Vector2Like;
};

function buildCellIdString(tileId: CellId): string {
    return `${tileId.x}_${tileId.z}`;
}

class HeightmapRootTexture {
    public readonly texture: THREE.Texture;

    private readonly rendertarget: THREE.WebGLRenderTarget;
    private readonly maxNesting: number;

    private readonly fakeCamera = new THREE.PerspectiveCamera();

    private readonly computedTilesIds = new Set<string>();

    private isFirstUpdate: boolean = true;

    public constructor(params: Parameters) {
        const textureSize = params.baseCellSize * 2 ** params.maxNesting;
        this.rendertarget = new THREE.WebGLRenderTarget(textureSize, textureSize, {
            count: 1,
        });
        const texture = this.rendertarget.textures[0];
        if (!texture) {
            throw new Error();
        }
        this.texture = texture;
        this.maxNesting = params.maxNesting;
    }

    public dispose(): void {
        this.texture.dispose();
        this.rendertarget.dispose();
        this.computedTilesIds.clear();
    }

    public renderTile(tileId: TileId, renderer: THREE.WebGLRenderer, mesh: THREE.Object3D): void {
        const previousState = {
            autoClear: renderer.autoClear,
            autoClearColor: renderer.autoClearColor,
            autoClearDepth: renderer.autoClearDepth,
            clearColor: renderer.getClearColor(new THREE.Color()),
            clearAlpha: renderer.getClearAlpha(),
            renderTarget: renderer.getRenderTarget(),
        };

        renderer.autoClear = false;
        renderer.autoClearColor = false;
        renderer.autoClearDepth = false;
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(this.rendertarget);

        if (this.isFirstUpdate) {
            renderer.clear(true, true);
            this.isFirstUpdate = false;
        }

        renderer.render(mesh, this.fakeCamera);

        renderer.autoClear = previousState.autoClear;
        renderer.autoClearColor = previousState.autoClearColor;
        renderer.autoClearDepth = previousState.autoClearDepth;
        renderer.setClearColor(previousState.clearColor, previousState.clearAlpha);
        renderer.setRenderTarget(previousState.renderTarget);

        for (const cellId of this.getCellIdsListForTile(tileId)) {
            const cellIdString = buildCellIdString(cellId);
            this.computedTilesIds.add(cellIdString);
        }
    }

    public hasFullTile(tileId: TileId): boolean {
        for (const cellId of this.getCellIdsListForTile(tileId)) {
            if (!this.hasCell(cellId)) {
                return false;
            }
        }
        return true;
    }

    public hasCell(cellId: CellId): boolean {
        const cellIdString = buildCellIdString(cellId);
        return this.computedTilesIds.has(cellIdString);
    }

    public getTileUv(tileId: TileId): UvChunk {
        const scale = 1 / 2 ** tileId.nestingLevel;
        const shift = {
            x: tileId.localCoords.x * scale,
            y: tileId.localCoords.z * scale,
        };
        return { scale, shift };
    }

    private getCellIdsListForTile(tileId: TileId): Iterable<CellId> {
        if (tileId.nestingLevel > this.maxNesting) {
            throw new Error();
        }

        const sizeInBaseCells = 2 ** (this.maxNesting - tileId.nestingLevel);
        const fromBaseCell = {
            x: tileId.localCoords.x * sizeInBaseCells,
            z: tileId.localCoords.z * sizeInBaseCells,
        };
        const toBaseCell = {
            x: fromBaseCell.x + sizeInBaseCells,
            z: fromBaseCell.z + sizeInBaseCells,
        };

        const cellIdsList: CellId[] = [];
        for (let iZ = fromBaseCell.z; iZ < toBaseCell.z; iZ++) {
            for (let iX = fromBaseCell.x; iX < toBaseCell.x; iX++) {
                cellIdsList.push({ x: iX, z: iZ });
            }
        }
        return cellIdsList;
    }
}

export { HeightmapRootTexture, type Parameters, type TileId };
