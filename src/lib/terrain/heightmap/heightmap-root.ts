import * as THREE from '../../three-usage';

import { HeightmapNode, type HeightmapSampler } from './heightmap-node';
import { HeightmapNodeId } from './heightmap-node-id';

class HeightmapRoot {
    public readonly container: THREE.Object3D;

    private readonly sampler: HeightmapSampler;
    private readonly maxLevel: number;
    private readonly maxLevelSizeInVoxels: number;

    private readonly topNodes: Record<string, HeightmapNode> = {};

    private readonly garbageCollectInterval = 10000;
    private lastGarbageCollectTimestamp = performance.now();

    public constructor(sampler: HeightmapSampler, maxLevel: number) {
        this.container = new THREE.Group();
        this.sampler = sampler;
        this.maxLevel = maxLevel;
        this.maxLevelSizeInVoxels = HeightmapNodeId.getLevelSizeInVoxels(this.maxLevel);
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
        const centralTopNodeId = new HeightmapNodeId(this.maxLevel, {
            x: Math.floor(voxelId.x / this.maxLevelSizeInVoxels),
            y: Math.floor(voxelId.y / this.maxLevelSizeInVoxels),
        });
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
        return new HeightmapNodeId(this.maxLevel, {
            x: Math.floor(nodeId.coordsInLevel.x / shrinkFactor),
            y: Math.floor(nodeId.coordsInLevel.y / shrinkFactor),
        });
    }
}

export { HeightmapRoot };
