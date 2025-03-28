import GUI from 'lil-gui';
import * as THREE from 'three-usage-test';

import {
    BoardOverlaysHandler,
    BoardRenderableFactory,
    ClutterViewer,
    computeBoard,
    EBoardSquareType,
    EComputationMethod,
    HeightmapViewerCpu,
    MaterialsStore,
    PromisesQueue,
    TerrainViewer,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    VoxelmapWrapper,
    type Board,
    type BoardRenderable,
    type IHeightmap,
    type IVoxelMap,
    type VoxelsChunkOrdering,
} from '../lib';

import { LineOfSight } from './board/line-of-sight';
import { PathFinder } from './board/path-finder';
import { type HeightmapSample } from './map/voxel-map';
import { TestBase } from './test-base';

interface ITerrainMap {
    sampleHeightmapBaseTerrain(x: number, z: number): HeightmapSample;
}

class TestBoard extends TestBase {
    protected readonly terrainViewer: TerrainViewer;

    private readonly clutterViewer: ClutterViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly voxelMaterialsStore: MaterialsStore;
    private readonly map: VoxelmapWrapper;

    private readonly gui: GUI;

    public constructor(map: IVoxelMap & IHeightmap & ITerrainMap) {
        super();

        this.gui = new GUI();

        this.camera.position.y = 150;
        this.cameraControl.target.y = this.camera.position.y - 10;

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.target.position.set(0, 0, 0);
        dirLight.position.set(100, 50, 100);
        this.scene.add(dirLight);

        const ambientLight = new THREE.AmbientLight(0xffffff);
        this.scene.add(ambientLight);

        const chunkSize = { xz: 64, y: 64 };
        const minChunkIdY = Math.floor(map.altitude.min / chunkSize.y);
        const maxChunkIdY = Math.floor(map.altitude.max / chunkSize.y);

        this.voxelMaterialsStore = new MaterialsStore({
            voxelMaterialsList: map.voxelTypesDefininitions.solidMaterials,
            maxShininess: 400,
        });

        const voxelsChunkOrdering: VoxelsChunkOrdering = 'zyx';

        this.clutterViewer = new ClutterViewer({
            clutterVoxelsDefinitions: map.voxelTypesDefininitions.clutterVoxels,
            chunkSize,
            computationOptions: {
                method: 'worker',
                threadsCount: 1,
            },
            voxelsChunkOrdering,
        });

        this.voxelmapViewer = new VoxelmapViewer({
            chunkSize,
            chunkIdY: {
                min: minChunkIdY,
                max: maxChunkIdY,
            },
            voxelMaterialsStore: this.voxelMaterialsStore,
            clutterViewer: this.clutterViewer,
            options: {
                computationOptions: {
                    method: EComputationMethod.CPU_MULTITHREADED,
                    threadsCount: 4,
                    greedyMeshing: true,
                },
                checkerboardType: 'xz',
                voxelsChunkOrdering,
            },
        });
        this.voxelmapViewer.parameters.faces.checkerboardContrast = 0.01;

        const heightmapViewer = new HeightmapViewerCpu(map, {
            materialsStore: this.voxelMaterialsStore,
            basePatchSize: chunkSize.xz,
            maxLevel: 5,
            voxelRatio: 2,
        });

        this.terrainViewer = new TerrainViewer(heightmapViewer, this.voxelmapViewer);
        this.terrainViewer.parameters.lod.enabled = false;
        this.scene.add(this.terrainViewer.container);

        this.voxelmapVisibilityComputer = new VoxelmapVisibilityComputer(this.voxelmapViewer.chunkSizeVec3, minChunkIdY, maxChunkIdY);
        this.voxelmapVisibilityComputer.showMapAroundPosition({ x: 0, y: 0, z: 0 }, 200);

        this.setupBoard(map);

        this.map = new VoxelmapWrapper(map, chunkSize, minChunkIdY, maxChunkIdY, true);
        this.map.onChange.push(modifiedChunksIdsList => {
            if (modifiedChunksIdsList.length > 0) {
                this.promisesQueue.cancelAll();
                for (const chunkId of modifiedChunksIdsList) {
                    this.voxelmapViewer.invalidateChunk(chunkId);
                }
            }
        });
        this.promisesQueue = new PromisesQueue(this.voxelmapViewer.maxChunksComputedInParallel + 5);

        this.applyVisibility();
        setInterval(() => this.applyVisibility(), 200);
    }

    protected override update(): void {
        this.terrainViewer.update(this.renderer);
    }

    private applyVisibility(): void {
        const chunksToDisplay = this.voxelmapVisibilityComputer.getRequestedChunks();
        const chunksIdsToDisplay = chunksToDisplay.map(chunkToDisplay => chunkToDisplay.id);

        this.voxelmapViewer.setVisibility(chunksIdsToDisplay);

        this.promisesQueue.cancelAll();
        for (const chunkId of chunksIdsToDisplay) {
            if (this.voxelmapViewer.doesChunkRequireVoxelsData(chunkId)) {
                this.promisesQueue.run(
                    async () => {
                        if (this.voxelmapViewer.doesChunkRequireVoxelsData(chunkId)) {
                            const voxelsChunkBox = this.voxelmapViewer.getChunkBox(chunkId);
                            const blockStart = voxelsChunkBox.min;
                            const blockEnd = voxelsChunkBox.max;

                            const chunkMapData = await this.map.getLocalMapData(blockStart, blockEnd);
                            const voxelsChunkData = Object.assign(chunkMapData, {
                                size: new THREE.Vector3().subVectors(blockEnd, blockStart),
                            });
                            // const computationStatus =
                            await this.voxelmapViewer.enqueueChunk(chunkId, voxelsChunkData);
                            // console.log(`${chunkId.asString} computation status: ${computationStatus}`);
                        }
                    },
                    () => {
                        this.voxelmapViewer.dequeueChunk(chunkId);
                        // console.log(`${chunkId.asString} query & computation cancelled`);
                    }
                );
            }
        }
    }

    private setupBoard(voxelMap: IVoxelMap & ITerrainMap): void {
        const factory = new BoardRenderableFactory({
            voxelMaterialsStore: this.voxelMaterialsStore,
        });

        const parameters = {
            boardRadius: 31,
            testLineOfSight: false,
            testPathFinding: true,
        };

        const boardContainer = new THREE.Group();
        boardContainer.name = 'board-container';
        this.scene.add(boardContainer);
        let currentBoard: {
            board: Board;
            renderable: BoardRenderable;
        } | null = null;

        const boardOverlaysHandler = new BoardOverlaysHandler({ board: { size: { x: 1, z: 1 }, origin: { x: 0, y: 0, z: 0 } } });

        const boardCenterContainer = new THREE.Group();
        boardCenterContainer.name = 'board-center-container';
        const boardCenter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }));
        boardCenter.name = 'board-center';
        boardCenter.position.set(0.5, 0.5, 0.5);
        boardCenterContainer.add(boardCenter);

        let lastBoardRequestId = -1;
        const requestBoard = async () => {
            lastBoardRequestId++;
            const requestId = lastBoardRequestId;

            const origin = boardCenterContainer.position.clone();

            const board = await computeBoard(voxelMap, origin, parameters.boardRadius);
            const renderable = await factory.buildBoardRenderable(board);
            boardOverlaysHandler.reset(board);

            if (lastBoardRequestId !== requestId) {
                return; // another request was launched in the meantime
            }

            boardContainer.clear();
            if (currentBoard) {
                currentBoard.renderable.dispose();
                this.map.unregisterBoard(currentBoard.board);
                boardOverlaysHandler.container.removeFromParent();
            }
            currentBoard = { renderable, board };

            if (!this.map.includeBoard) {
                boardContainer.add(currentBoard.renderable.container);
            }
            this.map.registerBoard(currentBoard.board);
            this.scene.add(boardOverlaysHandler.container);

            boardOverlaysHandler.clearSquares();

            if (parameters.testLineOfSight) {
                const lineOfSight = new LineOfSight({
                    grid: {
                        size: board.size,
                        cells: board.squares.map(square => square.type === EBoardSquareType.OBSTACLE),
                    },
                });
                const gridVisibility = lineOfSight.computeCellsVisibility({ x: parameters.boardRadius, z: parameters.boardRadius }, 10);
                const cellsVisibilities = gridVisibility.cells.filter(cell => {
                    return board.squares[cell.x + cell.z * board.size.x]!.type === EBoardSquareType.FLAT;
                });
                const visibleSquares = cellsVisibilities.filter(cell => cell.visibility === 'visible');
                const obstructedSquares = cellsVisibilities.filter(cell => cell.visibility === 'hidden');
                boardOverlaysHandler.displaySquares(visibleSquares, new THREE.Color(0x00ff00));
                boardOverlaysHandler.displaySquares(obstructedSquares, new THREE.Color(0xff0000));
            } else if (parameters.testPathFinding) {
                const pathFinder = new PathFinder({
                    grid: {
                        size: board.size,
                        cells: board.squares.map(square => square.type === EBoardSquareType.FLAT),
                    },
                });

                {
                    pathFinder.setOrigin({ x: parameters.boardRadius, z: parameters.boardRadius });
                    const reachableCells = pathFinder.getReachableCells(10);
                    boardOverlaysHandler.displayBlob(0, reachableCells, new THREE.Color(0x88dd88), 0.5);
                    const path = pathFinder.findPathTo({ x: 31, z: 35 });
                    if (path) {
                        boardOverlaysHandler.displaySquares(path, new THREE.Color(0x88dd88), 1);
                    }
                }

                {
                    pathFinder.setOrigin({ x: parameters.boardRadius - 5, z: parameters.boardRadius - 5 });
                    const reachableCells = pathFinder.getReachableCells(7);
                    boardOverlaysHandler.displayBlob(1, reachableCells, new THREE.Color(0xdd8888), 0.5);
                }
            }
        };

        const updateAltitude = () => {
            const terrainSample = voxelMap.sampleHeightmapBaseTerrain(
                Math.floor(boardCenterContainer.position.x),
                Math.floor(boardCenterContainer.position.z)
            );
            boardCenterContainer.position.setY(terrainSample.altitude + 1);
            requestBoard();
        };
        updateAltitude();

        const boardCenterControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
        boardCenterControls.showY = false;
        boardCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        boardCenterControls.addEventListener('change', updateAltitude);
        boardCenterControls.attach(boardCenterContainer);

        const rayCaster = new THREE.Raycaster();
        window.addEventListener('click', event => {
            const mouse = new THREE.Vector2(
                (event.clientX / this.renderer.domElement.clientWidth) * 2 - 1,
                -(event.clientY / this.renderer.domElement.clientHeight) * 2 + 1
            );
            rayCaster.setFromCamera(mouse, this.camera);
            const intersection = boardOverlaysHandler.rayIntersection(rayCaster.ray);
            if (intersection) {
                boardOverlaysHandler.displaySquares([intersection.cellId], new THREE.Color(0x7777ff));
            }
        });

        this.scene.add(boardCenterContainer);
        this.scene.add(boardCenterControls.getHelper());

        this.gui.add(parameters, 'boardRadius', 30, 60, 1).name('board radius').onChange(requestBoard);
        this.gui.add(parameters, 'testLineOfSight').name('line of sight').onChange(requestBoard);
        this.gui.add(parameters, 'testPathFinding').name('path finding').onChange(requestBoard);
    }
}

export { TestBoard };
