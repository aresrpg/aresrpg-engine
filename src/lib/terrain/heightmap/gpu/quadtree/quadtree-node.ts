type Coord2D = Readonly<{
    readonly x: number;
    readonly z: number;
}>;

type QuadtreeNodeId = {
    readonly level: number;
    readonly worldCoords: Coord2D;
};

type ReadonlyQuadtreeNode = {
    readonly nodeId: QuadtreeNodeId;
    readonly visible: boolean;
    getChildren(): {
        readonly mm: ReadonlyQuadtreeNode;
        readonly mp: ReadonlyQuadtreeNode;
        readonly pm: ReadonlyQuadtreeNode;
        readonly pp: ReadonlyQuadtreeNode;
    } | null;
};

class QuadtreeNode implements ReadonlyQuadtreeNode {
    public readonly nodeId: QuadtreeNodeId;

    public visible: boolean = true;

    private children: {
        readonly mm: QuadtreeNode;
        readonly mp: QuadtreeNode;
        readonly pm: QuadtreeNode;
        readonly pp: QuadtreeNode;
    } | null = null;

    public constructor(nodeId: QuadtreeNodeId) {
        this.nodeId = nodeId;
    }

    public getOrBuildChild(localCoords: Coord2D): QuadtreeNode {
        if (this.nodeId.level === 0) {
            throw new Error('Cannot a level == 0 QuadtreeNode cannot have children.');
        }

        if (!this.children) {
            const buildChild = (childX: 0 | 1, childY: 0 | 1): QuadtreeNode => {
                return new QuadtreeNode({
                    level: childrenLevel,
                    worldCoords: { x: 2 * this.nodeId.worldCoords.x + childX, z: 2 * this.nodeId.worldCoords.z + childY },
                });
            };

            const childrenLevel = this.nodeId.level - 1;
            this.children = {
                mm: buildChild(0, 0),
                mp: buildChild(0, 1),
                pm: buildChild(1, 0),
                pp: buildChild(1, 1),
            };
        }

        const stringId = `${'mp'[localCoords.x]}${'mp'[localCoords.z]}` as 'mm' | 'mp' | 'pm' | 'pp';
        return this.children[stringId];
    }

    public tryGetChild(localCoords: Coord2D): QuadtreeNode | null {
        if (this.children) {
            const stringId = `${'mp'[localCoords.x]}${'mp'[localCoords.z]}` as 'mm' | 'mp' | 'pm' | 'pp';
            return this.children[stringId] ?? null;
        } else {
            return null;
        }
    }

    public getChildren(): ReturnType<ReadonlyQuadtreeNode['getChildren']> {
        return this.children;
    }
}

export { QuadtreeNode, type Coord2D, type QuadtreeNodeId, type ReadonlyQuadtreeNode };
