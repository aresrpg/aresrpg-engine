import { safeModulo } from '../../../../helpers/math';

import { QuadtreeNode, type ReadonlyQuadtreeNode, type QuadtreeNodeId } from './quadtree-node';

type Parameters = {
    readonly maxNesting: number;
};

class Quadtree {
    private readonly maxNesting: number;

    private readonly rootNodes = new Map<string, QuadtreeNode>();

    public constructor(params: Parameters) {
        this.maxNesting = params.maxNesting;
    }

    public getRootNodes(): Iterable<ReadonlyQuadtreeNode> {
        return this.rootNodes.values();
    }

    public getOrBuildNode(nodeId: QuadtreeNodeId): QuadtreeNode {
        const levelCoords = this.buildLocalNodeIdsList(nodeId);

        const rootNodeCoords = levelCoords[0];
        if (!rootNodeCoords) {
            throw new Error();
        }
        const rootNodeId = this.buildRootNodeId(rootNodeCoords);
        let currentNode = this.rootNodes.get(rootNodeId) ?? null;
        if (!currentNode) {
            currentNode = new QuadtreeNode(rootNodeCoords);
            this.rootNodes.set(rootNodeId, currentNode);
        }

        for (let iLevel = 1; iLevel < levelCoords.length && currentNode; iLevel++) {
            const coordsInLevel = levelCoords[iLevel]!.worldCoords;
            const coordsInParent = { x: safeModulo(coordsInLevel.x, 2), z: safeModulo(coordsInLevel.z, 2) };
            currentNode = currentNode.getOrBuildChild(coordsInParent);
        }
        return currentNode;
    }

    public tryGetNode(nodeId: QuadtreeNodeId): QuadtreeNode | null {
        const levelCoords = this.buildLocalNodeIdsList(nodeId);

        const rootNodeCoords = levelCoords[0];
        if (!rootNodeCoords) {
            throw new Error();
        }
        const rootNodeId = this.buildRootNodeId(rootNodeCoords);
        let currentNode = this.rootNodes.get(rootNodeId) ?? null;

        for (let iLevel = 1; iLevel < levelCoords.length && currentNode; iLevel++) {
            const coordsInLevel = levelCoords[iLevel]!.worldCoords;
            const coordsInParent = { x: coordsInLevel.x % 2, z: coordsInLevel.z % 2 };
            currentNode = currentNode.tryGetChild(coordsInParent);
        }

        return currentNode ?? null;
    }

    private buildLocalNodeIdsList(nodeId: QuadtreeNodeId): QuadtreeNodeId[] {
        if (nodeId.level > this.maxNesting) {
            throw new Error();
        }

        let previousNodeId = nodeId;
        const nodeIdsList: QuadtreeNodeId[] = [previousNodeId];

        while (previousNodeId.level < this.maxNesting) {
            previousNodeId = {
                level: previousNodeId.level + 1,
                worldCoords: {
                    x: Math.floor(previousNodeId.worldCoords.x / 2),
                    z: Math.floor(previousNodeId.worldCoords.z / 2),
                },
            };
            nodeIdsList.push(previousNodeId);
        }

        return nodeIdsList.reverse();
    }

    private buildRootNodeId(nodeId: QuadtreeNodeId): string {
        if (nodeId.level !== this.maxNesting) {
            throw new Error();
        }
        return `${nodeId.worldCoords.x}_${nodeId.worldCoords.z}`;
    }
}

export { Quadtree, type QuadtreeNodeId };
