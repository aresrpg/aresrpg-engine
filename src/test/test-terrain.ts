import * as THREE from 'three-usage-test';

import {
    BoardOverlaysHandler,
    BoardRenderableFactory,
    computeBoard,
    EBoardSquareType,
    EComputationMethod,
    EVoxelsDisplayMode,
    HeightmapViewerCpu,
    HeightmapViewerGpu,
    InstancedBillboard,
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

import { LineOfSight } from './board/line-of-sight';
import { PathFinder } from './board/path-finder';
import { type VoxelMap } from './map/voxel-map';
import { TestTerrainBase, type ITerrainMap } from './test-terrain-base';

class TestTerrain extends TestTerrainBase {
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

        const fakeCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        const helper = new THREE.CameraHelper(fakeCamera);
        this.scene.add(helper);
        const fakeCameraControls = new THREE.TransformControls(fakeCamera, this.renderer.domElement);
        fakeCameraControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        fakeCameraControls.attach(fakeCamera);
        this.scene.add(fakeCamera);
        this.scene.add(fakeCameraControls.getHelper());

        const testBoard = true;
        if (testBoard) {
            this.setupBoard(map);
        }

        const chunkSize = { xz: 64, y: 64 };
        const minChunkIdY = Math.floor(map.minAltitude / chunkSize.y);
        const maxChunkIdY = Math.floor(map.maxAltitude / chunkSize.y);

        this.voxelmapViewer = new VoxelmapViewer(minChunkIdY, maxChunkIdY, this.voxelMaterialsStore, {
            patchSize: chunkSize,
            computationOptions: {
                method: EComputationMethod.CPU_MULTITHREADED,
                threadsCount: 4,
                greedyMeshing: true,
            },
            checkerboardType: 'xz',
            voxelsChunkOrdering: 'zyx',
        });
        this.voxelmapViewer.parameters.faces.checkerboardContrast = 0.01;
        setInterval(() => {
            this.voxelmapViewer.setAdaptativeQuality({
                distanceThreshold: 100,
                cameraPosition: this.camera.getWorldPosition(new THREE.Vector3()),
            });
        }, 150);

        const testHeightmapViewerGpu = true;
        const heightmapViewer = testHeightmapViewerGpu
            ? new HeightmapViewerGpu({
                  basePatch: {
                      worldSize: chunkSize.xz,
                      segmentsCount: chunkSize.xz / 2,
                  },
                  maxNesting: 5,
                  heightmap: map,
                  flatShading: true,
              })
            : new HeightmapViewerCpu(map, {
                  basePatchSize: chunkSize.xz,
                  maxLevel: 5,
                  voxelRatio: 2,
                  flatShading: true,
              });

        this.terrainViewer = new TerrainViewer(heightmapViewer, this.voxelmapViewer);
        this.voxelmapViewer.parameters.shadows.cast = this.enableShadows;
        this.voxelmapViewer.parameters.shadows.receive = this.enableShadows;
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
                    const getAllTreesForBlock = 'getAllTreesForBlock' as 'getAllTreesForBlock';
                    const trees = (map as VoxelMap)[getAllTreesForBlock](
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
                origin: { x: 0, y: -0.5 },
                lockAxis: { x: 0, y: 1, z: 0 },
                rendering: {
                    material: 'Phong',
                    shadows: { receive: this.enableShadows },
                    uniforms: {
                        uTexture: {
                            value: new THREE.TextureLoader().load('/resources/tree.png', texture => {
                                texture.colorSpace = THREE.SRGBColorSpace;
                            }),
                            type: 'sampler2D',
                        },
                    },
                    attributes: {},
                    fragmentCode: `
vec4 sampled = texture(uTexture, uv);
if (sampled.a < 0.5) {
    discard;
}
return vec4(sampled.rgb / sampled.a, 1);
`,
                },
            });
            this.scene.add(instancedBillboard.container);

            this.trees = { perPatch, instancedBillboard };

            const updateTreesAndScheduleNextUpdate = () => {
                instancedBillboard.setInstancesCount(totalTreesCount);
                this.updateTreeBillboards();
                setTimeout(() => {
                    updateTreesAndScheduleNextUpdate();
                }, 2000);
            };
            updateTreesAndScheduleNextUpdate();
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

        {
            const texturingOptions = {
                textured: EVoxelsDisplayMode.TEXTURED,
                normals: EVoxelsDisplayMode.NORMALS,
                grey: EVoxelsDisplayMode.GREY,
            };

            const voxelsFolder = this.gui.addFolder('Voxels');
            voxelsFolder.open();
            const parameters = {
                shadows: this.enableShadows,
                face: {
                    texturing: Object.entries(texturingOptions).find(a => a[1] === this.voxelmapViewer.parameters.faces.displayMode)![0],
                    noise: this.voxelmapViewer.parameters.faces.noiseContrast,
                    checkerboard: this.voxelmapViewer.parameters.faces.checkerboardContrast,
                },
                edgeSmoothness: this.voxelmapViewer.parameters.smoothEdges.radius,
                ao: { ...this.voxelmapViewer.parameters.ao },
                specular: { ...this.voxelmapViewer.parameters.specular },
            };
            voxelsFolder.add(this.voxelmapViewer.container, 'visible').name('Show voxels');
            voxelsFolder
                .add(parameters, 'shadows')
                .name('Enable shadows')
                .onChange(() => {
                    this.voxelmapViewer.parameters.shadows.cast = parameters.shadows;
                    this.voxelmapViewer.parameters.shadows.receive = parameters.shadows;
                });
            voxelsFolder
                .add(parameters.face, 'texturing', texturingOptions)
                .name('Display mode')
                .onChange(() => {
                    this.voxelmapViewer.parameters.faces.displayMode = Number(parameters.face.texturing);
                });
            voxelsFolder
                .add(parameters.face, 'noise', 0, 0.1, 0.001)
                .name('Noise contrast')
                .onChange(() => {
                    this.voxelmapViewer.parameters.faces.noiseContrast = parameters.face.noise;
                });
            voxelsFolder
                .add(parameters.face, 'checkerboard', 0, this.voxelmapViewer.maxSmoothEdgeRadius, 0.001)
                .name('Checkerboard contrast')
                .onChange(() => {
                    this.voxelmapViewer.parameters.faces.checkerboardContrast = parameters.face.checkerboard;
                });
            voxelsFolder
                .add(parameters, 'edgeSmoothness', 0, 0.2, 0.01)
                .name('Edge smoothness')
                .onChange(() => {
                    this.voxelmapViewer.parameters.smoothEdges.radius = parameters.edgeSmoothness;
                });

            voxelsFolder
                .add(parameters.ao, 'enabled')
                .name('AO enabled')
                .onChange(() => {
                    this.voxelmapViewer.parameters.ao.enabled = parameters.ao.enabled;
                });
            voxelsFolder
                .add(parameters.ao, 'spread', 0, 1)
                .name('AO spread')
                .onChange(() => {
                    this.voxelmapViewer.parameters.ao.spread = parameters.ao.spread;
                });
            voxelsFolder
                .add(parameters.ao, 'strength', 0, 1)
                .name('AO strength')
                .onChange(() => {
                    this.voxelmapViewer.parameters.ao.strength = parameters.ao.strength;
                });

            voxelsFolder
                .add(parameters.specular, 'strength', 0, 1)
                .name('Specular strength')
                .onChange(() => {
                    this.voxelmapViewer.parameters.specular.strength = parameters.specular.strength;
                });
        }
        {
            const lodFolder = this.gui.addFolder('LOD');
            lodFolder.add(this.terrainViewer.parameters.lod, 'enabled');
            lodFolder.add(heightmapViewer.container.scale, 'y', 0.00001, 1).name('Y scale');
            lodFolder.add(this.terrainViewer.parameters.lod, 'wireframe');
            lodFolder.open();
        }
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
                const instanceId = i++;
                this.trees.instancedBillboard.setInstanceTransform(instanceId, 0, { x: 11, y: 15 });
                this.trees.instancedBillboard.setInstancePosition(instanceId, {
                    x: tree.x,
                    y: tree.y - Number(patchIsLod) * 100,
                    z: tree.z,
                });
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
            voxelMaterialsStore: this.voxelMaterialsStore,
        });

        const testLineOfSight = false;
        const testPathFinding = true;

        const boardContainer = new THREE.Group();
        this.scene.add(boardContainer);
        let currentBoard: {
            board: Board;
            renderable: BoardRenderable;
        } | null = null;

        const boardOverlaysHandler = new BoardOverlaysHandler({ board: { size: { x: 1, z: 1 }, origin: { x: 0, y: 0, z: 0 } } });

        let lastBoardRequestId = -1;
        const requestBoard = async (origin: THREE.Vector3Like) => {
            lastBoardRequestId++;
            const requestId = lastBoardRequestId;

            const boardRadius = 31;
            const board = await computeBoard(voxelMap, origin, boardRadius);
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
                boardOverlaysHandler.displaySquares(visibleSquares, new THREE.Color(0x00ff00));
                boardOverlaysHandler.displaySquares(obstructedSquares, new THREE.Color(0xff0000));
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
                    boardOverlaysHandler.displayBlob(0, reachableCells, new THREE.Color(0x88dd88), 0.5);
                    const path = pathFinder.findPathTo({ x: 31, z: 35 });
                    if (path) {
                        boardOverlaysHandler.displaySquares(path, new THREE.Color(0x88dd88), 1);
                    }
                }

                {
                    pathFinder.setOrigin({ x: boardRadius - 5, z: boardRadius - 5 });
                    const reachableCells = pathFinder.getReachableCells(7);
                    boardOverlaysHandler.displayBlob(1, reachableCells, new THREE.Color(0xdd8888), 0.5);
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
