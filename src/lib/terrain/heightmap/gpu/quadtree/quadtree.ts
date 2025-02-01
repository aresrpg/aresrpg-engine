import { safeModulo } from '../../../../helpers/math';

import { QuadtreeNode, type QuadtreeNodeId, type ReadonlyQuadtreeNode } from './quadtree-node';

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
            const coordsInLevel = levelCoords[iLevel]!.worldCoordsInLevel;
            const coordsInParent = {
                x: safeModulo(coordsInLevel.x, 2) as 0 | 1,
                z: safeModulo(coordsInLevel.z, 2) as 0 | 1,
            };
            currentNode = currentNode.getOrBuildChild(coordsInParent);
        }

        return currentNode;
    }

    private buildLocalNodeIdsList(nodeId: QuadtreeNodeId): QuadtreeNodeId[] {
        if (nodeId.nestingLevel > this.maxNesting) {
            throw new Error();
        }

        const nodeIdsList: QuadtreeNodeId[] = [];
        for (let iNestingLevel = 0; iNestingLevel <= nodeId.nestingLevel; iNestingLevel++) {
            nodeIdsList.push({
                nestingLevel: iNestingLevel,
                worldCoordsInLevel: {
                    x: Math.floor(nodeId.worldCoordsInLevel.x / 2 ** (this.maxNesting - iNestingLevel)),
                    z: Math.floor(nodeId.worldCoordsInLevel.z / 2 ** (this.maxNesting - iNestingLevel)),
                },
            });
        }
        return nodeIdsList;
    }

    private buildRootNodeId(nodeId: QuadtreeNodeId): string {
        if (nodeId.nestingLevel !== 0) {
            throw new Error();
        }
        return `${nodeId.worldCoordsInLevel.x}_${nodeId.worldCoordsInLevel.z}`;
    }
}

export { Quadtree, type QuadtreeNodeId };
