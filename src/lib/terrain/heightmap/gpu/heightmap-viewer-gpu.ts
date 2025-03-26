import { disableMatrixAutoupdate } from '../../../helpers/misc';
import * as THREE from '../../../libs/three-usage';
import type { HeightmapAtlas } from '../atlas/heightmap-atlas';
import type { IHeightmapViewer, PatchId } from '../i-heightmap-viewer';

import { HeightmapRootTile } from './meshes/heightmap-root-tile';
import type { HeightmapTile } from './meshes/heightmap-tile';
import { EEdgeResolution, TileGeometryStore } from './meshes/tile-geometry-store';
import { Quadtree } from './quadtree/quadtree';
import type { QuadtreeNode, ReadonlyQuadtreeNode } from './quadtree/quadtree-node';

type HeightmapViewerGpuStatistics = {
    rootTilesCount: number;
    tilesCount: number;
};

type Parameters = {
    readonly heightmapAtlas: HeightmapAtlas;
    readonly flatShading: boolean;
    readonly transitionTime?: number;
    readonly garbageCollecting?: {
        readonly maxInvisibleRootTilesInCache?: number;
        readonly frequency?: number;
    };
};

class HeightmapViewerGpu implements IHeightmapViewer {
    public readonly container: THREE.Object3D;

    public get basePatchSize(): number {
        return this.heightmapAtlas.leafTileSizeInWorld;
    }

    focusPoint: THREE.Vector2Like = new THREE.Vector2();
    focusDistance: number = 3;
    visibilityDistance: number = 5;

    public wireframe: boolean = false;

    private readonly heightmapAtlas: HeightmapAtlas;
    private readonly geometryStore: TileGeometryStore;
    private readonly flatShading: boolean;
    private readonly transitionTime: number;

    private get rootTileSize(): number {
        return this.heightmapAtlas.rootTileSizeInWorld;
    }

    private get maxNesting(): number {
        return this.heightmapAtlas.maxNestingLevel;
    }

    private readonly garbageCollecting: {
        readonly maxInvisibleRootTilesInCache: number;
        readonly frequency: number;
        handle: number | null;
    };

    private readonly rootTilesMap = new Map<string, HeightmapRootTile>();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmapviewer-gpu-container';
        disableMatrixAutoupdate(this.container);

        this.heightmapAtlas = params.heightmapAtlas;
        this.geometryStore = new TileGeometryStore({
            segmentsCount: params.heightmapAtlas.leafTileSizeInTexels, // will not be texel-perfect but decimation requires an even count
            altitude: params.heightmapAtlas.heightmap.altitude,
        });
        this.flatShading = params.flatShading;
        this.transitionTime = params.transitionTime ?? 250;

        this.garbageCollecting = {
            maxInvisibleRootTilesInCache: params.garbageCollecting?.maxInvisibleRootTilesInCache ?? 10,
            frequency: params.garbageCollecting?.frequency ?? 5000,
            handle: null,
        };
        this.garbageCollecting.handle = window.setInterval(() => {
            this.garbageCollect();
        }, this.garbageCollecting.frequency);
    }

    public update(): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.wireframe = this.wireframe;
            rootTile.update();
        }
    }

    public setHiddenPatches(patches: Iterable<PatchId>): void {
        const quadtree = new Quadtree();
        this.applyFocusToQuadtree(quadtree);
        this.hideLeafsInQuatree(quadtree, patches);

        this.updateMeshes(quadtree);
    }

    public getStatistics(): HeightmapViewerGpuStatistics {
        const result = {
            rootTilesCount: this.rootTilesMap.size,
            tilesCount: 0,
        };

        this.container.traverseVisible(child => {
            if ('isMesh' in child && child.isMesh) {
                result.tilesCount++;
            }
        });
        return result;
    }

    private applyFocusToQuadtree(quadtree: Quadtree): void {
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

    private hideLeafsInQuatree(quadtree: Quadtree, patches: Iterable<PatchId>): void {
        for (const patch of patches) {
            const quadtreeNode = quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: patch });
            quadtreeNode.setVisible(false);

            for (let dX = -1; dX <= 1; dX++) {
                for (let dZ = -1; dZ <= 1; dZ++) {
                    quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: { x: patch.x + dX, z: patch.z + dZ } });
                }
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
                        geometryStore: this.geometryStore,
                        heightmapAtlas: this.heightmapAtlas,
                        tileId: rootQuadtreeNode.nodeId.worldCoordsInLevel,
                        flatShading: this.flatShading,
                        transitionTime: this.transitionTime,
                    });
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

        const rootTilesToDelete = invisibleRootTilesList.slice(this.garbageCollecting.maxInvisibleRootTilesInCache);
        for (const rootTile of rootTilesToDelete) {
            rootTile.rootTile.dispose();
            this.rootTilesMap.delete(rootTile.id);
        }
    }
}

export { HeightmapViewerGpu, type HeightmapViewerGpuStatistics, type Parameters };
