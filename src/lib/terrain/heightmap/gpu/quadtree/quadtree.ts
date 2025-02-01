import { safeModulo } from '../../../../helpers/math';

import { QuadtreeNode, type QuadtreeNodeId, type ReadonlyQuadtreeNode } from './quadtree-node';

class Quadtree {
    private readonly rootNodes = new Map<string, QuadtreeNode>();

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

        const ensureNeighbourExist = (node: QuadtreeNode, dX: number, dZ: number): void => {
            this.getOrBuildNode({
                nestingLevel: node.nodeId.nestingLevel,
                worldCoordsInLevel: {
                    x: node.nodeId.worldCoordsInLevel.x + dX,
                    z: node.nodeId.worldCoordsInLevel.z + dZ,
                },
            });
        };

        for (let iLevel = 1; iLevel < levelCoords.length && currentNode; iLevel++) {
            if (!currentNode.getChildren()) {
                currentNode.subdivide();

                ensureNeighbourExist(currentNode, -1, 0);
                ensureNeighbourExist(currentNode, +1, 0);
                ensureNeighbourExist(currentNode, 0, -1);
                ensureNeighbourExist(currentNode, 0, +1);
            }

            const coordsInLevel = levelCoords[iLevel]!.worldCoordsInLevel;
            const currentNodeChildId = {
                x: safeModulo(coordsInLevel.x, 2) as 0 | 1,
                z: safeModulo(coordsInLevel.z, 2) as 0 | 1,
            };
            currentNode = currentNode.getChild(currentNodeChildId);
        }

        return currentNode;
    }

    private buildLocalNodeIdsList(nodeId: QuadtreeNodeId): QuadtreeNodeId[] {
        const nodeIdsList: QuadtreeNodeId[] = [];
        for (let iNestingLevel = 0; iNestingLevel <= nodeId.nestingLevel; iNestingLevel++) {
            const nodeWorldSize = 2 ** (nodeId.nestingLevel - iNestingLevel);

            nodeIdsList.push({
                nestingLevel: iNestingLevel,
                worldCoordsInLevel: {
                    x: Math.floor(nodeId.worldCoordsInLevel.x / nodeWorldSize),
                    z: Math.floor(nodeId.worldCoordsInLevel.z / nodeWorldSize),
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
