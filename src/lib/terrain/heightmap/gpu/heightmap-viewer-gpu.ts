import { disableMatrixAutoupdate } from '../../../helpers/misc';
import * as THREE from '../../../libs/three-usage';
import { type MaterialsStore } from '../../materials-store';
import { type IHeightmap } from '../i-heightmap';
import { type IHeightmapViewer, type PatchId } from '../i-heightmap-viewer';

import { HeightmapRootTile } from './meshes/heightmap-root-tile';
import { type HeightmapTile } from './meshes/heightmap-tile';
import { EEdgeResolution, TileGeometryStore } from './meshes/tile-geometry-store';
import { Quadtree } from './quadtree/quadtree';
import { type QuadtreeNode, type ReadonlyQuadtreeNode } from './quadtree/quadtree-node';

type HeightmapViewerGpuStatistics = {
    rootTilesCount: number;
    gpuMemoryBytes: number;
};

type Parameters = {
    readonly materialsStore: MaterialsStore;
    readonly basePatch: {
        readonly worldSize: number;
        readonly segmentsCount: number;
    };
    readonly maxNesting: number;
    readonly heightmap: IHeightmap;
    readonly flatShading: boolean;
    readonly garbageCollecting?: {
        readonly maxInvisibleRootTilesInCache?: number;
        readonly frequency?: number;
    };
};

class HeightmapViewerGpu implements IHeightmapViewer {
    public readonly container: THREE.Object3D;

    public readonly basePatchSize: number;

    focusPoint: THREE.Vector2Like = new THREE.Vector2();
    focusDistance: number = 3;
    visibilityDistance: number = 5;

    public wireframe: boolean = false;

    private readonly materialsStore: MaterialsStore;
    private readonly geometryStore: TileGeometryStore;
    private readonly heightmap: IHeightmap;
    private readonly maxNesting: number;
    private readonly segmentsCount: number;
    private readonly flatShading: boolean;

    private readonly garbageCollecting: {
        readonly maxInvisibleRootTilesInCache: number;
        readonly frequency: number;
        handle: number | null;
    };

    private readonly rootTileSize: number;
    private readonly rootTilesMap = new Map<string, HeightmapRootTile>();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmapviewer-gpu-container';
        disableMatrixAutoupdate(this.container);

        this.materialsStore = params.materialsStore;
        this.geometryStore = new TileGeometryStore({
            segmentsCount: params.basePatch.segmentsCount,
            altitude: params.heightmap.altitude,
        });
        this.heightmap = params.heightmap;
        this.maxNesting = params.maxNesting;
        this.segmentsCount = params.basePatch.segmentsCount;
        this.flatShading = params.flatShading;

        this.garbageCollecting = {
            maxInvisibleRootTilesInCache: params.garbageCollecting?.maxInvisibleRootTilesInCache ?? 10,
            frequency: params.garbageCollecting?.frequency ?? 5000,
            handle: null,
        };
        this.garbageCollecting.handle = window.setInterval(() => {
            this.garbageCollect();
        }, this.garbageCollecting.frequency);

        this.basePatchSize = params.basePatch.worldSize;
        this.rootTileSize = this.basePatchSize * 2 ** this.maxNesting;
    }

    public update(renderer: THREE.WebGLRenderer): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.wireframe = this.wireframe;
            rootTile.update(renderer);
        }
    }

    public setHiddenPatches(patches: Iterable<PatchId>): void {
        const quadtree = new Quadtree();

        this.applyVisibility(quadtree);

        for (const patch of patches) {
            const quadtreeNode = quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: patch });
            quadtreeNode.setVisible(false);

            for (let dX = -1; dX <= 1; dX++) {
                for (let dZ = -1; dZ <= 1; dZ++) {
                    quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: { x: patch.x + dX, z: patch.z + dZ } });
                }
            }
        }

        this.updateMeshes(quadtree);
    }

    public getStatistics(): HeightmapViewerGpuStatistics {
        const result = {
            rootTilesCount: 0,
            gpuMemoryBytes: 0,
        };
        for (const rootTile of this.rootTilesMap.values()) {
            result.rootTilesCount++;
            result.gpuMemoryBytes += rootTile.getTotalGpuMemoryBytes();
        }
        return result;
    }

    private applyVisibility(quadtree: Quadtree): void {
        for (const rootNode of quadtree.getRootNodes()) {
            rootNode.setVisible(false);
        }

        const rootNodeFrom = new THREE.Vector2()
            .copy(this.focusPoint)
            .subScalar(this.visibilityDistance)
            .divideScalar(this.rootTileSize)
            .floor();
        const rootNodeTo = new THREE.Vector2()
            .copy(this.focusPoint)
            .addScalar(this.visibilityDistance)
            .divideScalar(this.rootTileSize)
            .floor();
        for (let iX = rootNodeFrom.x; iX <= rootNodeTo.x; iX++) {
            for (let iZ = rootNodeFrom.y; iZ <= rootNodeTo.y; iZ++) {
                const rootNode = quadtree.getOrBuildNode({ nestingLevel: 0, worldCoordsInLevel: { x: iX, z: iZ } });
                rootNode.setVisible(true);
            }
        }

        const cellNodeFrom = new THREE.Vector2()
            .copy(this.focusPoint)
            .subScalar(this.focusDistance)
            .divideScalar(this.basePatchSize)
            .floor();
        const cellNodeTo = new THREE.Vector2().copy(this.focusPoint).addScalar(this.focusDistance).divideScalar(this.basePatchSize).floor();
        for (let iX = cellNodeFrom.x; iX <= cellNodeTo.x; iX++) {
            for (let iZ = cellNodeFrom.y; iZ <= cellNodeTo.y; iZ++) {
                const node = quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: { x: iX, z: iZ } });
                node.setVisible(true);
            }
        }
    }

    private updateMeshes(quadtree: Quadtree): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.setVisibility(false);
        }

        const getNeighbour = (quadtreeNode: ReadonlyQuadtreeNode, dX: number, dZ: number): QuadtreeNode | null => {
            return quadtree.tryGetNode({
                nestingLevel: quadtreeNode.nodeId.nestingLevel,
                worldCoordsInLevel: {
                    x: quadtreeNode.nodeId.worldCoordsInLevel.x + dX,
                    z: quadtreeNode.nodeId.worldCoordsInLevel.z + dZ,
                },
            });
        };

        const udpateTile = (tile: HeightmapTile, quadtreeNode: ReadonlyQuadtreeNode): void => {
            tile.setVisibility(quadtreeNode.isVisible());
            if (quadtreeNode.isVisible()) {
                const quadtreeNodeChildren = quadtreeNode.getChildren();
                if (quadtreeNodeChildren) {
                    tile.subdivide();
                    udpateTile(tile.children!.mm, quadtreeNodeChildren.mm);
                    udpateTile(tile.children!.mp, quadtreeNodeChildren.mp);
                    udpateTile(tile.children!.pm, quadtreeNodeChildren.pm);
                    udpateTile(tile.children!.pp, quadtreeNodeChildren.pp);
                } else {
                    tile.merge();

                    const neighbours = {
                        up: getNeighbour(quadtreeNode, 0, +1),
                        down: getNeighbour(quadtreeNode, 0, -1),
                        left: getNeighbour(quadtreeNode, -1, 0),
                        right: getNeighbour(quadtreeNode, +1, 0),
                        downLeft: getNeighbour(quadtreeNode, -1, -1),
                        downRight: getNeighbour(quadtreeNode, +1, -1),
                        upLeft: getNeighbour(quadtreeNode, -1, +1),
                        upRight: getNeighbour(quadtreeNode, +1, +1),
                    };

                    tile.setEdgesResolution({
                        up: neighbours.up ? EEdgeResolution.SIMPLE : EEdgeResolution.DECIMATED,
                        down: neighbours.down ? EEdgeResolution.SIMPLE : EEdgeResolution.DECIMATED,
                        left: neighbours.left ? EEdgeResolution.SIMPLE : EEdgeResolution.DECIMATED,
                        right: neighbours.right ? EEdgeResolution.SIMPLE : EEdgeResolution.DECIMATED,
                    });
                    tile.setEdgesDrop({
                        up: neighbours.up?.isVisible() === false,
                        down: neighbours.down?.isVisible() === false,
                        left: neighbours.left?.isVisible() === false,
                        right: neighbours.right?.isVisible() === false,
                        upLeft: neighbours.upLeft?.isVisible() === false,
                        upRight: neighbours.upRight?.isVisible() === false,
                        downLeft: neighbours.downLeft?.isVisible() === false,
                        downRight: neighbours.downRight?.isVisible() === false,
                    });
                }
            }
        };

        for (const rootQuadtreeNode of quadtree.getRootNodes()) {
            if (rootQuadtreeNode.isVisible()) {
                const rootTileId = `${rootQuadtreeNode.nodeId.worldCoordsInLevel.x}_${rootQuadtreeNode.nodeId.worldCoordsInLevel.z}`;
                let rootTile = this.rootTilesMap.get(rootTileId);
                if (!rootTile) {
                    rootTile = new HeightmapRootTile({
                        materialsStore: this.materialsStore,
                        geometryStore: this.geometryStore,
                        heightmap: this.heightmap,
                        baseCell: {
                            worldSize: this.basePatchSize,
                            segmentsCount: this.segmentsCount,
                        },
                        tileId: rootQuadtreeNode.nodeId.worldCoordsInLevel,
                        maxNesting: this.maxNesting,
                        flatShading: this.flatShading,
                    });
                    rootTile.container.applyMatrix4(
                        new THREE.Matrix4().makeTranslation(
                            rootQuadtreeNode.nodeId.worldCoordsInLevel.x,
                            0,
                            rootQuadtreeNode.nodeId.worldCoordsInLevel.z
                        )
                    );
                    rootTile.container.applyMatrix4(new THREE.Matrix4().makeScale(this.rootTileSize, 1, this.rootTileSize));
                    this.container.add(rootTile.container);
                    this.rootTilesMap.set(rootTileId, rootTile);
                }
                udpateTile(rootTile, rootQuadtreeNode);
            }
        }
    }

    private garbageCollect(): void {
        type RootTile = {
            readonly id: string;
            readonly rootTile: HeightmapRootTile;
            readonly invisibleSinceTimestamp: number;
        };

        const invisibleRootTilesList: RootTile[] = [];
        for (const [id, rootTile] of this.rootTilesMap.entries()) {
            const invisibleSinceTimestamp = rootTile.isInvisibleSince();
            if (invisibleSinceTimestamp) {
                invisibleRootTilesList.push({ id, rootTile, invisibleSinceTimestamp });
            }
        }
        invisibleRootTilesList.sort((a, b) => a.invisibleSinceTimestamp - b.invisibleSinceTimestamp);

        const rootTilesToDelete = invisibleRootTilesList.slice(0, this.garbageCollecting.maxInvisibleRootTilesInCache);
        for (const rootTile of rootTilesToDelete) {
            rootTile.rootTile.dispose();
            this.rootTilesMap.delete(rootTile.id);
        }
    }
}

export { HeightmapViewerGpu, type HeightmapViewerGpuStatistics, type Parameters };
