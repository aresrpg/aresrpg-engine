import * as THREE from '../../../libs/three-usage';
import { type IHeightmap } from '../i-heightmap';
import { type HeightmapStatistics, type IHeightmapViewer } from '../i-heightmap-viewer';

import { HeightmapRootTile } from './meshes/heightmap-root-tile';
import { type HeightmapTile } from './meshes/heightmap-tile';
import { TileGeometryStore } from './meshes/tile-geometry-store';
import { Quadtree } from './quadtree/quadtree';
import { type ReadonlyQuadtreeNode } from './quadtree/quadtree-node';

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

    private readonly rootTilesMap = new Map<string, HeightmapRootTile>();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'heightmap-viewer';

        this.basePatchSize = params.basePatchSize;

        this.geometryStore = new TileGeometryStore(params.segmentsCount);
        this.heightmap = params.heightmap;
        this.maxNesting = params.maxNesting;
        this.segmentsCount = params.segmentsCount;
    }

    public update(renderer: THREE.WebGLRenderer): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.wireframe = this.wireframe;
            rootTile.update(renderer);
        }
    }

    public setHiddenPatches(patches: ReadonlyArray<{ x: number; z: number }>): void {
        const quadtree = new Quadtree();

        for (const patch of patches) {
            const quadtreeNode = quadtree.getOrBuildNode({ nestingLevel: this.maxNesting, worldCoordsInLevel: patch });
            quadtreeNode.visible = false;
        }

        this.updateMeshes(quadtree);
    }

    public getStatistics(): HeightmapStatistics {
        throw new Error('Method not implemented.');
    }

    private updateMeshes(quadtree: Quadtree): void {
        for (const rootTile of this.rootTilesMap.values()) {
            rootTile.setVisibility(false);
        }

        const udpateTile = (tile: HeightmapTile, quadtreeNode: ReadonlyQuadtreeNode): void => {
            tile.setVisibility(quadtreeNode.visible);
            if (quadtreeNode.visible) {
                const quadtreeNodeChildren = quadtreeNode.getChildren();
                if (quadtreeNodeChildren) {
                    tile.subdivide();
                    udpateTile(tile.children!.mm, quadtreeNodeChildren.mm);
                    udpateTile(tile.children!.mp, quadtreeNodeChildren.mp);
                    udpateTile(tile.children!.pm, quadtreeNodeChildren.pm);
                    udpateTile(tile.children!.pp, quadtreeNodeChildren.pp);
                } else {
                    tile.merge();
                }
            }
        };

        const rootTileSize = this.basePatchSize * 2 ** this.maxNesting;

        for (const rootQuadtreeNode of quadtree.getRootNodes()) {
            if (rootQuadtreeNode.visible) {
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
