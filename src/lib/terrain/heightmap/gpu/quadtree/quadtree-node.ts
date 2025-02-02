type ChildId = {
    readonly x: 0 | 1;
    readonly z: 0 | 1;
};

type QuadtreeNodeId = {
    readonly nestingLevel: number;
    readonly worldCoordsInLevel: {
        readonly x: number;
        readonly z: number;
    };
};

type ReadonlyQuadtreeNode = {
    readonly nodeId: QuadtreeNodeId;
    setVisible(visible: boolean): void;
    isVisible(): boolean;
    getChildren(): {
        readonly mm: ReadonlyQuadtreeNode;
        readonly mp: ReadonlyQuadtreeNode;
        readonly pm: ReadonlyQuadtreeNode;
        readonly pp: ReadonlyQuadtreeNode;
    } | null;
};

class QuadtreeNode implements ReadonlyQuadtreeNode {
    public readonly nodeId: QuadtreeNodeId;

    private visible: boolean = true;

    private children: {
        readonly mm: QuadtreeNode;
        readonly mp: QuadtreeNode;
        readonly pm: QuadtreeNode;
        readonly pp: QuadtreeNode;
    } | null = null;

    public constructor(nodeId: QuadtreeNodeId) {
        this.nodeId = nodeId;
    }

    public subdivide(): void {
        const buildChild = (childX: 0 | 1, childY: 0 | 1): QuadtreeNode => {
            return new QuadtreeNode({
                nestingLevel: this.nodeId.nestingLevel + 1,
                worldCoordsInLevel: {
                    x: 2 * this.nodeId.worldCoordsInLevel.x + childX,
                    z: 2 * this.nodeId.worldCoordsInLevel.z + childY,
                },
            });
        };

        this.children = {
            mm: buildChild(0, 0),
            mp: buildChild(0, 1),
            pm: buildChild(1, 0),
            pp: buildChild(1, 1),
        };
    }

    public getChildren(): ReturnType<ReadonlyQuadtreeNode['getChildren']> {
        return this.children;
    }

    public getChild(childId: ChildId): QuadtreeNode {
        if (!this.children) {
            throw new Error();
        }

        const stringId = `${'mp'[childId.x]}${'mp'[childId.z]}` as 'mm' | 'mp' | 'pm' | 'pp';
        return this.children[stringId];
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public isVisible(): boolean {
        if (!this.visible) {
            return false;
        }

        if (this.children) {
            for (const child of Object.values(this.children)) {
                if (child.isVisible()) {
                    return true;
                }
            }
            return false;
        }

        return true;
    }
}

export { QuadtreeNode, type ChildId, type QuadtreeNodeId, type ReadonlyQuadtreeNode };
