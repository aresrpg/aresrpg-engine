import { logger } from "../../helpers/logger";
import * as THREE from "../../three-usage";
import { HeightmapNodeId } from "./heightmap-node-id";

type Children = {
    readonly mm: HeightmapNode,
    readonly mp: HeightmapNode,
    readonly pm: HeightmapNode,
    readonly pp: HeightmapNode,
};

type GeometryData = {
    readonly positions: ReadonlyArray<number>;
    readonly indices: number[];
};

type EdgesType = {
    readonly upSimple: boolean;
    readonly downSimple: boolean;
    readonly leftSimple: boolean;
    readonly rightSimple: boolean;
    readonly code: number;
};

let trianglesCount = 0;

class HeightmapNode {
    private static readonly material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, wireframe: true });

    public readonly container: THREE.Object3D;

    private meshes: Record<number, THREE.Mesh> = {};
    private children: Children | null = null;
    private isSubdivided: boolean = false;

    private readonly root: HeightmapNode | null = null;
    private readonly id: HeightmapNodeId;

    public constructor(id: HeightmapNodeId, root?: HeightmapNode) {
        this.id = id;
        if (root) {
            this.root = root;
        }

        this.container = new THREE.Group();
        this.container.name = `Heightmap node ${this.id.asString()}`;
    }

    public getOrBuildSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        if (this.id.equals(nodeId)) {
            return this;
        } else if (nodeId.level >= this.id.level) {
            // node cannot be not a child of this
            return null;
        }

        if (this.id.contains(nodeId)) {
            if (!this.children) {
                this.split();
            }
            const children = this.children;
            if (!children) {
                throw new Error();
            }
            for (const child of this.childrenList) {
                const result = child.getOrBuildSubNode(nodeId);
                if (result) {
                    return result;
                }
            }
            throw new Error();
        }

        return null;
    }

    public getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        if (this.id.equals(nodeId)) {
            return this;
        } else if (nodeId.level >= this.id.level) {
            // node cannot be not a child of this
            return null;
        }

        if (this.id.contains(nodeId)) {
            if (!this.children) {
                return null;
            }

            for (const child of this.childrenList) {
                const result = child.getSubNode(nodeId);
                if (result) {
                    return result;
                }
            }
            // throw new Error();
        }

        return null;
    }

    public dispose(): void {
        this.container.clear();

        for (const mesh of Object.values(this.meshes)) {
            mesh.geometry.dispose();
        }
        this.meshes = {};

        if (this.children) {
            for (const child of this.childrenList) {
                child.dispose();
            }
            this.children = null;
        }
    }

    public update(): void {
        this.container.clear();

        if (this.isSubdivided) {
            for (const child of this.childrenList) {
                child.update();
                this.container.add(child.container);
            }
        } else {
            const edgesType = this.buildEdgesType();

            let mesh = this.meshes[edgesType.code];
            if (!mesh) {
                const geometryData = this.buildGeometryData(edgesType);

                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute("position", new THREE.Float32BufferAttribute(geometryData.positions, 3));
                geometry.setIndex(geometryData.indices);
                geometry.computeVertexNormals();

                mesh = new THREE.Mesh(geometry, HeightmapNode.material);
                mesh.name = `Heightmap node mesh ${this.id.asString()}`;
                const firstVoxelPosition = this.id.box.min;
                mesh.position.set(firstVoxelPosition.x, 0, firstVoxelPosition.y);
                this.meshes[edgesType.code] = mesh;
            }
            this.container.add(mesh);
        }
    }

    private split(): void {
        if (this.children || this.id.level <= 0) {
            logger.warn("Cannot split heightmap node");
            return;
        }

        if (this.root) {
            this.root.getOrBuildSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x - 1, y: this.id.coordsInLevel.y + 0 }));
            this.root.getOrBuildSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 1, y: this.id.coordsInLevel.y + 0 }));
            this.root.getOrBuildSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 0, y: this.id.coordsInLevel.y - 1 }));
            this.root.getOrBuildSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 0, y: this.id.coordsInLevel.y + 1 }));
        }

        const childrenLevel = this.id.level - 1;
        const subLevelBaseCoords = new THREE.Vector2().copy(this.id.coordsInLevel).multiplyScalar(2);
        const root = this.root || this;

        this.children = {
            mm: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 0, y: subLevelBaseCoords.y + 0 }), root),
            pm: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 1, y: subLevelBaseCoords.y + 0 }), root),
            mp: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 0, y: subLevelBaseCoords.y + 1 }), root),
            pp: new HeightmapNode(new HeightmapNodeId(this.id.shift, childrenLevel, { x: subLevelBaseCoords.x + 1, y: subLevelBaseCoords.y + 1 }), root),
        };

        this.container.clear();
        for (const child of this.childrenList) {
            this.container.add(child.container);
        }

        this.isSubdivided = true;
    }

    private get childrenList(): HeightmapNode[] {
        if (this.children) {
            return Object.values(this.children);
        }
        return [];
    }

    private buildGeometryData(edgesType: EdgesType): GeometryData {
        console.log("Building geometry");
        const levelScaling = (1 << this.id.level);
        const voxelRatio = 4;
        const voxelsCount = HeightmapNodeId.smallestLevelSizeInVoxels;
        const quadsCount = voxelsCount / voxelRatio;
        const scaling = levelScaling * voxelRatio;

        const geometryData: number[] = [];
        const indexData: number[] = [];

        const buildInnerIndex = (x: number, y: number) => y + x * (quadsCount - 1);

        { // inner part
            for (let iX = 1; iX < quadsCount; iX++) {
                for (let iY = 1; iY < quadsCount; iY++) {
                    geometryData.push(scaling * iX, 0, scaling * iY);
                }
            }

            for (let iX = 0; iX < quadsCount - 2; iX++) {
                for (let iY = 0; iY < quadsCount - 2; iY++) {
                    const mm = buildInnerIndex(iX + 0, iY + 0);
                    const mp = buildInnerIndex(iX + 0, iY + 1);
                    const pm = buildInnerIndex(iX + 1, iY + 0);
                    const pp = buildInnerIndex(iX + 1, iY + 1);
                    indexData.push(mm, pp, pm, mm, mp, pp)
                    trianglesCount += 2;
                }
            }
        }

        { // outer part

            const mmCornerIndex = geometryData.length / 3;
            geometryData.push(0, 0, 0);

            const mpCornerIndex = geometryData.length / 3;
            geometryData.push(0, 0, scaling * quadsCount);

            const pmCornerIndex = geometryData.length / 3;
            geometryData.push(scaling * quadsCount, 0, 0);

            const ppCornerIndex = geometryData.length / 3;
            geometryData.push(scaling * quadsCount, 0, scaling * quadsCount);

            const buildEdge = (simpleEdge: boolean, invertEdgeIfSimple: boolean, cornerIndex1: number, cornerIndex2: number, innerFrom: THREE.Vector2Like, innerTo: THREE.Vector2Like) => {
                const innerIndices: number[] = [buildInnerIndex(innerFrom.x, innerFrom.y)];
                {
                    const innerStepsCount = quadsCount - 2;
                    const innerStep = { x: (innerTo.x - innerFrom.x) / innerStepsCount, y: (innerTo.y - innerFrom.y) / innerStepsCount };
                    for (let i = 1; i <= innerStepsCount - 1; i++) {
                        innerIndices.push(buildInnerIndex(innerFrom.x + i * innerStep.x, innerFrom.y + i * innerStep.y));
                    }
                    innerIndices.push(buildInnerIndex(innerTo.x, innerTo.y));
                }

                const outerFrom = { x: geometryData[3 * cornerIndex1]!, y: geometryData[3 * cornerIndex1 + 2]! };
                const outerTo = { x: geometryData[3 * cornerIndex2]!, y: geometryData[3 * cornerIndex2 + 2]! };

                const outerIndices: number[] = [cornerIndex1];

                const outerStepsCount = simpleEdge ? quadsCount : 2 * quadsCount;
                {
                    const outerStep = { x: (outerTo.x - outerFrom.x) / outerStepsCount, y: (outerTo.y - outerFrom.y) / outerStepsCount };
                    for (let i = 1; i <= outerStepsCount - 1; i++) {
                        outerIndices.push(geometryData.length / 3);
                        geometryData.push(outerFrom.x + i * outerStep.x, 0, outerFrom.y + i * outerStep.y);
                    }
                    outerIndices.push(cornerIndex2)
                }

                if (simpleEdge) {

                    if (invertEdgeIfSimple) {
                        innerIndices.reverse();
                        outerIndices.reverse();

                        indexData.push(outerIndices[1]!, innerIndices[0]!, outerIndices[0]!);
                        for (let i = 0; i < innerIndices.length - 1; i++) {
                            indexData.push(innerIndices[i + 1]!, innerIndices[i]!, outerIndices[i + 1]!);
                            indexData.push(innerIndices[i + 1]!, outerIndices[i + 1]!, outerIndices[i + 2]!);
                        }
                        indexData.push(outerIndices[outerIndices.length - 1]!, innerIndices[innerIndices.length - 1]!, outerIndices[outerIndices.length - 2]!);
                    } else {
                        indexData.push(outerIndices[0]!, innerIndices[0]!, outerIndices[1]!);
                        for (let i = 0; i < innerIndices.length - 1; i++) {
                            indexData.push(innerIndices[i]!, innerIndices[i + 1]!, outerIndices[i + 1]!);
                            indexData.push(innerIndices[i + 1]!, outerIndices[i + 2]!, outerIndices[i + 1]!);
                        }
                        indexData.push(outerIndices[outerIndices.length - 2]!, innerIndices[innerIndices.length - 1]!, outerIndices[outerIndices.length - 1]!);
                    }
                } else {
                    indexData.push(outerIndices[0]!, innerIndices[0]!, outerIndices[1]!);
                    for (let i = 0; i < innerIndices.length; i++) {
                        indexData.push(outerIndices[1 + 2 * i]!, innerIndices[i]!, outerIndices[2 + 2 * i]!);
                        if (i < innerIndices.length - 1) {
                            indexData.push(innerIndices[i]!, innerIndices[i + 1]!, outerIndices[3 + 2 * i]!);
                        }
                        indexData.push(outerIndices[2 + 2 * i]!, innerIndices[i]!, outerIndices[3 + 2 * i]!);
                    }
                    indexData.push(outerIndices[outerIndices.length - 2]!, innerIndices[innerIndices.length - 1]!, outerIndices[outerIndices.length - 1]!);
                }
            };

            buildEdge(edgesType.downSimple, false, mmCornerIndex, pmCornerIndex, { x: 0, y: 0 }, { x: quadsCount - 2, y: 0 });
            buildEdge(edgesType.rightSimple, true, pmCornerIndex, ppCornerIndex, { x: quadsCount - 2, y: 0 }, { x: quadsCount - 2, y: quadsCount - 2 });
            buildEdge(edgesType.upSimple, false, ppCornerIndex, mpCornerIndex, { x: quadsCount - 2, y: quadsCount - 2 }, { x: 0, y: quadsCount - 2 });
            buildEdge(edgesType.leftSimple, true, mpCornerIndex, mmCornerIndex, { x: 0, y: quadsCount - 2 }, { x: 0, y: 0 });
        }

        return { positions: geometryData, indices: indexData };
    }

    private buildEdgesType(): EdgesType {
        const upSimple = !this.root?.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x, y: this.id.coordsInLevel.y + 1 }))?.isSubdivided;
        const downSimple = !this.root?.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x, y: this.id.coordsInLevel.y - 1 }))?.isSubdivided;
        const leftSimple = !this.root?.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x - 1, y: this.id.coordsInLevel.y }))?.isSubdivided;
        const rightSimple = !this.root?.getSubNode(new HeightmapNodeId(this.id.shift, this.id.level, { x: this.id.coordsInLevel.x + 1, y: this.id.coordsInLevel.y }))?.isSubdivided;

        const code = (+upSimple) + (+downSimple << 1) + (+leftSimple << 2) + (+rightSimple << 3);
        return { upSimple, downSimple, leftSimple, rightSimple, code };
    }
}

export {
    HeightmapNode
};

