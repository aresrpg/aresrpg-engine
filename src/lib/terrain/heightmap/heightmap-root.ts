import { createMeshesStatistics, type MeshesStatistics } from '../../helpers/meshes-statistics';
import * as THREE from '../../three-usage';

import { HeightmapNode } from './heightmap-node';
import { HeightmapNodeId } from './heightmap-node-id';
import { type IHeightmap } from './i-heightmap';

class HeightmapRoot {
    public readonly container: THREE.Object3D;

    public readonly material = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 0 });

    public readonly smallestLevelSizeInVoxels: number;

    private readonly sampler: IHeightmap;
    private readonly maxLevel: number;
    private readonly maxLevelSizeInVoxels: number;

    private readonly topNodes: Record<string, HeightmapNode> = {};

    private readonly garbageCollectInterval = 10000;
    private lastGarbageCollectTimestamp = performance.now();

    public constructor(sampler: IHeightmap, maxLevel: number, smallestLevelSizeInVoxels: number) {
        this.container = new THREE.Group();

        this.smallestLevelSizeInVoxels = smallestLevelSizeInVoxels;

        this.sampler = sampler;
        this.maxLevel = maxLevel;
        this.maxLevelSizeInVoxels = HeightmapNodeId.getLevelSizeInVoxels(this.smallestLevelSizeInVoxels, this.maxLevel);
    }

    public getOrBuildSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        const topNodeId = this.buildTopNodeId(nodeId);
        let topNode = this.topNodes[topNodeId.asString()];
        if (!topNode) {
            topNode = new HeightmapNode(this.sampler, topNodeId, this);
            this.container.add(topNode.container);
            this.topNodes[topNodeId.asString()] = topNode;
        }
        return topNode.getOrBuildSubNode(nodeId);
    }

    public getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        const topNodeId = this.buildTopNodeId(nodeId);
        const topNode = this.topNodes[topNodeId.asString()];
        if (topNode) {
            return topNode.getSubNode(nodeId);
        }
        return null;
    }

    public resetSubdivisions(): void {
        for (const topNode of this.topNodesList) {
            topNode.resetSubdivisions();
        }
    }

    public applyVisibility(voxelId: THREE.Vector2Like, distance: number): void {
        const centralTopNodeId = new HeightmapNodeId(
            this.maxLevel,
            {
                x: Math.floor(voxelId.x / this.maxLevelSizeInVoxels),
                y: Math.floor(voxelId.y / this.maxLevelSizeInVoxels),
            },
            this
        );
        const margin = Math.ceil(distance / this.maxLevelSizeInVoxels);

        for (const topNode of this.topNodesList) {
            topNode.visible = false;
        }

        for (let dX = -margin; dX <= margin; dX++) {
            for (let dY = -margin; dY <= margin; dY++) {
                const topNode = this.getOrBuildSubNode(centralTopNodeId.getNeighbour(dX, dY));
                if (!topNode) {
                    throw new Error();
                }
                topNode.visible = true;
            }
        }

        const timeSinceLastGarbageCollect = performance.now() - this.lastGarbageCollectTimestamp;
        if (timeSinceLastGarbageCollect > this.garbageCollectInterval) {
            this.garbageCollect();
        }
    }

    public updateMesh(): void {
        for (const topNode of this.topNodesList) {
            topNode.updateMesh();
        }
    }

    public getStatistics(): MeshesStatistics {
        const result = createMeshesStatistics();

        for (const topNode of this.topNodesList) {
            const topNodeStatistics = topNode.getStatistics();

            result.meshes.loadedCount += topNodeStatistics.meshes.loadedCount;
            result.triangles.loadedCount += topNodeStatistics.triangles.loadedCount;

            result.gpuMemoryBytes += topNodeStatistics.gpuMemoryBytes;

            if (topNode.visible) {
                result.meshes.visibleCount += topNodeStatistics.meshes.visibleCount;
                result.triangles.visibleCount += topNodeStatistics.triangles.visibleCount;
            }
        }
        return result;
    }

    private garbageCollect(): void {
        for (const [id, topNode] of Object.entries(this.topNodes)) {
            if (!topNode.visible) {
                topNode.dispose();
                delete this.topNodes[id];
            }
        }
        this.lastGarbageCollectTimestamp = performance.now();
    }

    private get topNodesList(): HeightmapNode[] {
        return Object.values(this.topNodes);
    }

    private buildTopNodeId(nodeId: HeightmapNodeId): HeightmapNodeId {
        if (nodeId.level > this.maxLevel) {
            throw new Error();
        }

        const shrinkFactor = 1 << (this.maxLevel - nodeId.level);
        return new HeightmapNodeId(
            this.maxLevel,
            {
                x: Math.floor(nodeId.coordsInLevel.x / shrinkFactor),
                y: Math.floor(nodeId.coordsInLevel.y / shrinkFactor),
            },
            this
        );
    }
}

export { HeightmapRoot };
