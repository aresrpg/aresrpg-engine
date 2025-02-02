import * as THREE from '../../../libs/three-usage';
import { type IHeightmap } from '../i-heightmap';
import { type HeightmapStatistics, type IHeightmapViewer } from '../i-heightmap-viewer';

import { HeightmapRootTile } from './meshes/heightmap-root-tile';
import { type HeightmapTile } from './meshes/heightmap-tile';
import { EEdgeResolution, TileGeometryStore } from './meshes/tile-geometry-store';
import { Quadtree } from './quadtree/quadtree';
import { type QuadtreeNode, type ReadonlyQuadtreeNode } from './quadtree/quadtree-node';

type Parameters = {
    readonly basePatchSize: number;
    readonly segmentsCount: number;
    readonly maxNesting: number;
    readonly heightmap: IHeightmap;
};

class HeightmapViewerGpu implements IHeightmapViewer {
    public readonly container: THREE.Object3D;

    public readonly basePatchSize: number;

    focusPoint: THREE.Vector2Like = new THREE.Vector2();
    focusDistance: number = 3;
    visibilityDistance: number = 5;

    public wireframe: boolean = false;

    private readonly geometryStore: TileGeometryStore;
    private readonly heightmap: IHeightmap;
    private readonly maxNesting: number;
    private readonly segmentsCount: number;

    private readonly rootTileSize: number;
    private readonly rootTilesMap = new Map<string, HeightmapRootTile>();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmap-viewer';

        this.geometryStore = new TileGeometryStore(params.segmentsCount);
        this.heightmap = params.heightmap;
        this.maxNesting = params.maxNesting;
        this.segmentsCount = params.segmentsCount;

        this.basePatchSize = params.basePatchSize;
        this.rootTileSize = this.basePatchSize * 2 ** this.maxNesting;
    }

    public update(renderer: THREE.WebGLRenderer): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.wireframe = this.wireframe;
            rootTile.update(renderer);
        }
    }

    public setHiddenPatches(patches: ReadonlyArray<{ x: number; z: number }>): void {
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

    public getStatistics(): HeightmapStatistics {
        throw new Error('Method not implemented.');
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

        const rootTileSize = this.basePatchSize * 2 ** this.maxNesting;

        for (const rootQuadtreeNode of quadtree.getRootNodes()) {
            if (rootQuadtreeNode.isVisible()) {
                const rootTileId = `${rootQuadtreeNode.nodeId.worldCoordsInLevel.x}_${rootQuadtreeNode.nodeId.worldCoordsInLevel.z}`;
                let rootTile = this.rootTilesMap.get(rootTileId);
                if (!rootTile) {
                    rootTile = new HeightmapRootTile({
                        geometryStore: this.geometryStore,
                        heightmap: this.heightmap,
                        segmentsCount: this.segmentsCount,
                        maxNesting: this.maxNesting,
                        sizeWorld: rootTileSize,
                        originWorld: {
                            x: rootQuadtreeNode.nodeId.worldCoordsInLevel.x * rootTileSize,
                            z: rootQuadtreeNode.nodeId.worldCoordsInLevel.z * rootTileSize,
                        },
                    });
                    rootTile.container.applyMatrix4(
                        new THREE.Matrix4().makeTranslation(
                            rootQuadtreeNode.nodeId.worldCoordsInLevel.x,
                            0,
                            rootQuadtreeNode.nodeId.worldCoordsInLevel.z
                        )
                    );
                    rootTile.container.applyMatrix4(new THREE.Matrix4().makeScale(rootTileSize, 1, rootTileSize));
                    this.container.add(rootTile.container);
                    this.rootTilesMap.set(rootTileId, rootTile);
                }
                udpateTile(rootTile, rootQuadtreeNode);
            }
        }
    }
}

export { HeightmapViewerGpu, type Parameters };
