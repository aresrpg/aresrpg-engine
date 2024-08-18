import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import {
    computePlateau,
    EComputationMethod,
    EPlateauSquareType,
    HeightmapViewer,
    LineOfSight,
    PathFinder,
    PlateauHandler,
    PlateauRenderableFactory,
    PromisesQueue,
    TerrainViewer,
    VoxelmapViewer,
    VoxelmapVisibilityComputer,
    VoxelmapWrapper,
    type IHeightmap,
    type IVoxelMap,
    type Plateau,
    type PlateauRenderable,
} from '../lib';

import { TestBase, type ITerrainMap } from './test-base';

class TestTerrain extends TestBase {
    protected override readonly terrainViewer: TerrainViewer;

    private readonly voxelmapViewer: VoxelmapViewer;
    private readonly voxelmapVisibilityComputer: VoxelmapVisibilityComputer;
    private readonly promisesQueue: PromisesQueue;

    private readonly map: VoxelmapWrapper;

    public constructor(map: IVoxelMap & IHeightmap & ITerrainMap) {
        super(map);

        const testPlateau = true;
        if (testPlateau) {
            this.setupPlateau(map);
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
        this.terrainViewer.parameters.lod.enabled = false;
        // this.terrainViewer.parameters.lod.wireframe = true;
        this.scene.add(this.terrainViewer.container);

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

    private setupPlateau(voxelMap: IVoxelMap & ITerrainMap): void {
        const factory = new PlateauRenderableFactory({
            voxelMaterialsList: voxelMap.voxelMaterialsList,
        });

        const testLineOfSight = false;
        const testPathFinding = true;

        const plateauContainer = new THREE.Group();
        this.scene.add(plateauContainer);
        let currentPlateau: {
            plateau: Plateau;
            renderable: PlateauRenderable;
            handler: PlateauHandler;
        } | null = null;

        let lastPlateauRequestId = -1;
        const requestPlateau = async (origin: THREE.Vector3Like) => {
            lastPlateauRequestId++;
            const requestId = lastPlateauRequestId;

            const plateauRadius = 31;
            const plateau = await computePlateau(voxelMap, origin, plateauRadius);
            const renderable = await factory.buildPlateauRenderable(plateau);
            const handler = new PlateauHandler({ plateau });

            if (lastPlateauRequestId !== requestId) {
                return; // another request was launched in the meantime
            }

            plateauContainer.clear();
            if (currentPlateau) {
                currentPlateau.renderable.dispose();
                this.map.unregisterPlateau(currentPlateau.plateau);
                currentPlateau.handler.container.removeFromParent();
                currentPlateau.handler.dispose();
            }
            currentPlateau = { renderable, plateau, handler };

            if (!this.map.includePlateau) {
                plateauContainer.add(currentPlateau.renderable.container);
            }
            this.map.registerPlateau(currentPlateau.plateau);
            this.scene.add(handler.container);

            handler.clearSquares();

            if (testLineOfSight) {
                const lineOfSight = new LineOfSight({
                    grid: {
                        size: plateau.size,
                        cells: plateau.squares.map(square => square.type === EPlateauSquareType.OBSTACLE),
                    },
                });
                const gridVisibility = lineOfSight.computeCellsVisibility({ x: plateauRadius, z: plateauRadius }, 10);
                const cellsVisibilities = gridVisibility.cells.filter(cell => {
                    return plateau.squares[cell.x + cell.z * plateau.size.x]!.type === EPlateauSquareType.FLAT;
                });
                const visibleSquares = cellsVisibilities.filter(cell => cell.visibility === 'visible');
                const obstructedSquares = cellsVisibilities.filter(cell => cell.visibility === 'hidden');
                handler.displaySquares(visibleSquares, new THREE.Color(0x00ff00));
                handler.displaySquares(obstructedSquares, new THREE.Color(0xff0000));
            } else if (testPathFinding) {
                const pathFinder = new PathFinder({
                    grid: {
                        size: plateau.size,
                        cells: plateau.squares.map(square => square.type === EPlateauSquareType.FLAT),
                    },
                });
                pathFinder.setOrigin({ x: plateauRadius, z: plateauRadius });
                const reachableCells = pathFinder.getReachableCells(10);
                handler.displayBlob(reachableCells, new THREE.Color(0x88dd88), 0.5);
                const path = pathFinder.findPathTo({ x: 31, z: 35 });
                if (path) {
                    handler.displaySquares(path, new THREE.Color(0x88dd88), 1);
                }
            }
        };

        const plateauCenterContainer = new THREE.Group();
        const plateauCenter = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }));
        plateauCenter.position.set(0.5, 0.5, 0.5);
        plateauCenterContainer.add(plateauCenter);

        const updateAltitude = () => {
            const terrainSample = voxelMap.sampleHeightmapBaseTerrain(
                Math.floor(plateauCenterContainer.position.x),
                Math.floor(plateauCenterContainer.position.z)
            );
            plateauCenterContainer.position.setY(terrainSample.altitude + 1);
            requestPlateau(plateauCenterContainer.position.clone());
        };
        updateAltitude();

        const plateauCenterControls = new TransformControls(this.camera, this.renderer.domElement);
        plateauCenterControls.showY = false;
        plateauCenterControls.addEventListener('dragging-changed', event => {
            this.cameraControl.enabled = !event.value;
        });
        plateauCenterControls.addEventListener('change', updateAltitude);
        plateauCenterControls.attach(plateauCenterContainer);

        this.scene.add(plateauCenterContainer);
        this.scene.add(plateauCenterControls);
    }
}

export { TestTerrain };
