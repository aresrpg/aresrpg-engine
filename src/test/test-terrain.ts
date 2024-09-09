import * as THREE from 'three-usage-test';

import {
    BoardHandler,
    BoardRenderableFactory,
    computeBoard,
    EBoardSquareType,
    EComputationMethod,
    HeightmapViewer,
    InstancedBillboard,
    LineOfSight,
    PathFinder,
    PromisesQueue,
    TerrainViewer,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    VoxelmapWrapper,
    type Board,
    type BoardRenderable,
    type IHeightmap,
    type IVoxelMap,
} from '../lib';

import { type VoxelMap } from './map/voxel-map';
import { TestBase, type ITerrainMap } from './test-base';

class TestTerrain extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly map: VoxelmapWrapper;

    private readonly trees: {
        readonly perPatch: Map<string, THREE.Vector3Like[]>;
        readonly instancedBillboard: InstancedBillboard;
    } | null = null;

    public constructor(map: IVoxelMap & IHeightmap & ITerrainMap) {
        super(map);

        const testBoard = true;
        if (testBoard) {
            this.setupBoard(map);
        }

        const chunkSize = { xz: 64, y: 64 };
        const minChunkIdY = Math.floor(map.minAltitude / chunkSize.y);
        const maxChunkIdY = Math.floor(map.maxAltitude / chunkSize.y);

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, map.voxelMaterialsList, {
            patchSize: chunkSize,
            computationOptions: {
                method: EComputationMethod.CPU_MULTITHREADED,
                threadsCount: 4,
            },
            checkerboardType: 'xz',
        });
        this.voxelmapViewer.parameters.faces.checkerboardContrast = 0.01;

        const heightmapViewer = new HeightmapViewer(map, {
            basePatchSize: chunkSize.xz,
            maxLevel: 5,
            voxelRatio: 2,
        });

        this.terrainViewer = new TerrainViewer(heightmapViewer, this.voxelmapViewer);
        // this.terrainViewer.parameters.lod.enabled = false;
        // this.terrainViewer.parameters.lod.wireframe = true;
        this.scene.add(this.terrainViewer.container);

        if (!(map as VoxelMap).includeTreesInLod) {
            const perPatch = new Map<string, THREE.Vector3Like[]>();

            let totalTreesCount = 0;
            const maxLodPatch = Math.ceil(2000 / this.voxelmapViewer.chunkSize.xz);
            for (let iPatchZ = -maxLodPatch; iPatchZ <= maxLodPatch; iPatchZ++) {
                for (let iPatchX = -maxLodPatch; iPatchX <= maxLodPatch; iPatchX++) {
                    const id = `${iPatchX}_${iPatchZ}`;
                    const trees = (map as VoxelMap)["getAllTreesForBlock"]( // eslint-disable-line dot-notation
                        {
                            x: iPatchX * this.voxelmapViewer.chunkSize.xz,
                            y: iPatchZ * this.voxelmapViewer.chunkSize.xz,
                        },
                        {
                            x: (iPatchX + 1) * this.voxelmapViewer.chunkSize.xz,
                            y: (iPatchZ + 1) * this.voxelmapViewer.chunkSize.xz,
                        }
                    );
                    totalTreesCount += trees.length;
                    perPatch.set(id, trees);
                }
            }

            const instancedBillboard = new InstancedBillboard({
                origin: { x: 0, y: 0.5 * 240 },
                lockAxis: { x: 0, y: 1, z: 0 },
                baseSize: { x: 165, y: 240 },
            });
            this.scene.add(instancedBillboard.container);

            this.trees = { perPatch, instancedBillboard };

            const scheduleTreesUpdate = () => {
                setTimeout(() => {
                    instancedBillboard.setInstancesCount(totalTreesCount);
                    this.updateTreeBillboards();
                    scheduleTreesUpdate();
                }, 2000);
            };
            scheduleTreesUpdate();
        }

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(
            this.voxelmapViewer.patchSize,
            this.voxelmapViewer.minChunkIdY,
            this.voxelmapViewer.maxChunkIdY
        );

        this.map = new VoxelmapWrapper(map, chunkSize, minChunkIdY, maxChunkIdY, true);
        this.map.onChange.push(modifiedPatchesIdsList => {
            if (modifiedPatchesIdsList.length > 0) {
                this.promisesQueue.cancelAll();
                for (const patchId of modifiedPatchesIdsList) {
                    this.voxelmapViewer.invalidatePatch(patchId);
                }
            }
        });
        this.promisesQueue = new PromisesQueue(this.voxelmapViewer.maxPatchesComputedInParallel + 5);
    }

    private updateTreeBillboards(): void {
        if (!this.trees) {
            return;
        }

        const nonLodChunks = this.voxelmapViewer.getCompleteChunksColumns();

        let i = 0;
        for (const [patchIdString, trees] of this.trees.perPatch.entries()) {
            const [patchIdX, patchIdZ] = patchIdString.split('_').map(s => parseInt(s));
            const patchIsLod = !!nonLodChunks.find(chunkId => chunkId.x === patchIdX && chunkId.z === patchIdZ);

            for (const tree of trees) {
                this.trees.instancedBillboard.setInstanceTransform(
                    i++,
                    {
                        x: tree.x + 0.5,
                        y: tree.y - Number(patchIsLod) * 100,
                        z: tree.z + 0.5,
                    },
                    0,
                    1 / 15
                );
            }
        }
    }

    protected override showMapPortion(box: THREE.Box3): void {
        this.voxelmapVisibilityComputer.showMapPortion(box);
        this.applyVisibility();
    }

    protected override showMapAroundPosition(position: THREE.Vector3Like, radius: number, frustum?: THREE.Frustum): void {
        this.voxelmapVisibilityComputer.reset();
        this.voxelmapVisibilityComputer.showMapAroundPosition(position, radius, frustum);
        this.applyVisibility();
    }

    private applyVisibility(): void {
        const patchesToDisplay = this.voxelmapVisibilityComputer.getRequestedPatches();
        const patchesIdToDisplay = patchesToDisplay.map(patchToDisplay => patchToDisplay.id);

        this.voxelmapViewer.setVisibility(patchesIdToDisplay);

        this.promisesQueue.cancelAll();
        for (const patchId of patchesIdToDisplay) {
            if (this.voxelmapViewer.doesPatchRequireVoxelsData(patchId)) {
                this.promisesQueue.run(
                    async () => {
                        if (this.voxelmapViewer.doesPatchRequireVoxelsData(patchId)) {
                            const voxelsChunkBox = this.voxelmapViewer.getPatchVoxelsBox(patchId);
                            const blockStart = voxelsChunkBox.min;
                            const blockEnd = voxelsChunkBox.max;

                            const patchMapData = await this.map.getLocalMapData(blockStart, blockEnd);
                            const voxelsChunkData = Object.assign(patchMapData, {
                                size: new THREE.Vector3().subVectors(blockEnd, blockStart),
                            });
                            // const computationStatus =
                            await this.voxelmapViewer.enqueuePatch(patchId, voxelsChunkData);
                            // console.log(`${patchId.asString} computation status: ${computationStatus}`);
                        }
                    },
                    () => {
                        this.voxelmapViewer.dequeuePatch(patchId);
                        // console.log(`${patchId.asString} query & computation cancelled`);
                    }
                );
            }
        }
    }

    private setupBoard(voxelMap: IVoxelMap & ITerrainMap): void {
        const factory = new BoardRenderableFactory({
            voxelMaterialsList: voxelMap.voxelMaterialsList,
        });

        const testLineOfSight = false;
        const testPathFinding = true;

        const boardContainer = new THREE.Group();
        this.scene.add(boardContainer);
        let currentBoard: {
            board: Board;
            renderable: BoardRenderable;
            handler: BoardHandler;
        } | null = null;

        let lastBoardRequestId = -1;
        const requestBoard = async (origin: THREE.Vector3Like) => {
            lastBoardRequestId++;
            const requestId = lastBoardRequestId;

            const boardRadius = 31;
            const board = await computeBoard(voxelMap, origin, boardRadius);
            const renderable = await factory.buildBoardRenderable(board);
            const handler = new BoardHandler({ board });

            if (lastBoardRequestId !== requestId) {
                return; // another request was launched in the meantime
            }

            boardContainer.clear();
            if (currentBoard) {
                currentBoard.renderable.dispose();
                this.map.unregisterBoard(currentBoard.board);
                currentBoard.handler.container.removeFromParent();
                currentBoard.handler.dispose();
            }
            currentBoard = { renderable, board, handler };

            if (!this.map.includeBoard) {
                boardContainer.add(currentBoard.renderable.container);
            }
            this.map.registerBoard(currentBoard.board);
            this.scene.add(handler.container);

            handler.clearSquares();

            if (testLineOfSight) {
                const lineOfSight = new LineOfSight({
                    grid: {
                        size: board.size,
                        cells: board.squares.map(square => square.type === EBoardSquareType.OBSTACLE),
                    },
                });
                const gridVisibility = lineOfSight.computeCellsVisibility({ x: boardRadius, z: boardRadius }, 10);
                const cellsVisibilities = gridVisibility.cells.filter(cell => {
                    return board.squares[cell.x + cell.z * board.size.x]!.type === EBoardSquareType.FLAT;
                });
                const visibleSquares = cellsVisibilities.filter(cell => cell.visibility === 'visible');
                const obstructedSquares = cellsVisibilities.filter(cell => cell.visibility === 'hidden');
                handler.displaySquares(visibleSquares, new THREE.Color(0x00ff00));
                handler.displaySquares(obstructedSquares, new THREE.Color(0xff0000));
            } else if (testPathFinding) {
                const pathFinder = new PathFinder({
                    grid: {
                        size: board.size,
                        cells: board.squares.map(square => square.type === EBoardSquareType.FLAT),
                    },
                });

                {
                    pathFinder.setOrigin({ x: boardRadius, z: boardRadius });
                    const reachableCells = pathFinder.getReachableCells(10);
                    handler.displayBlob(0, reachableCells, new THREE.Color(0x88dd88), 0.5);
                    const path = pathFinder.findPathTo({ x: 31, z: 35 });
                    if (path) {
                        handler.displaySquares(path, new THREE.Color(0x88dd88), 1);
                    }
                }

                {
                    pathFinder.setOrigin({ x: boardRadius - 5, z: boardRadius - 5 });
                    const reachableCells = pathFinder.getReachableCells(7);
                    handler.displayBlob(1, reachableCells, new THREE.Color(0xdd8888), 0.5);
                }
            }
        };

        const boardCenterContainer = new THREE.Group();
        const boardCenter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }));
        boardCenter.position.set(0.5, 0.5, 0.5);
        boardCenterContainer.add(boardCenter);

        const updateAltitude = () => {
            const terrainSample = voxelMap.sampleHeightmapBaseTerrain(
                Math.floor(boardCenterContainer.position.x),
                Math.floor(boardCenterContainer.position.z)
            );
            boardCenterContainer.position.setY(terrainSample.altitude + 1);
            requestBoard(boardCenterContainer.position.clone());
        };
        updateAltitude();

        const boardCenterControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        boardCenterControls.showY = false;
        boardCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        boardCenterControls.addEventListener('change', updateAltitude);
        boardCenterControls.attach(boardCenterContainer);

        this.scene.add(boardCenterContainer);
        // this.scene.add(boardCenterControls);
    }
}

export { TestTerrain };
