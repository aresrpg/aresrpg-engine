import { logger } from '../../helpers/logger';
import * as THREE from '../../three-usage';
import type { IHeightmapSample } from '../i-voxel-map';

import { HeightmapNodeId } from './heightmap-node-id';

type Children = {
    readonly mm: HeightmapNode;
    readonly mp: HeightmapNode;
    readonly pm: HeightmapNode;
    readonly pp: HeightmapNode;
};

type GeometryData = {
    readonly positions: ReadonlyArray<number>;
    readonly colors: ReadonlyArray<number>;
    readonly indices: number[];
};

enum EEdgeType {
    SIMPLE = 0,
    TESSELATED = 1,
    LIMIT = 2,
}

type EdgesType = {
    readonly up: EEdgeType;
    readonly down: EEdgeType;
    readonly left: EEdgeType;
    readonly right: EEdgeType;
    readonly code: number;
};

type HeightmapSampler = {
    sampleHeightmap(x: number, y: number): IHeightmapSample;
};

interface IHeightmapRoot {
    getOrBuildSubNode(nodeId: HeightmapNodeId): HeightmapNode | null;
    getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null;
}

class HeightmapNode {
    private static readonly material = new THREE.MeshPhongMaterial({ vertexColors: true });

    public readonly container: THREE.Object3D;

    private meshes: Record<number, THREE.Mesh> = {};
    private children: Children | null = null;
    private isSubdivided: boolean = false;

    private readonly sampler: HeightmapSampler;
    private readonly root: IHeightmapRoot;
    private readonly id: HeightmapNodeId;

    public constructor(sampler: HeightmapSampler, id: HeightmapNodeId, root: IHeightmapRoot) {
        this.sampler = sampler;
        this.id = id;
        this.root = root;

        this.container = new THREE.Group();
        this.container.name = `Heightmap node ${this.id.asString()}`;
    }

    public resetSubdivisions(): void {
        if (this.isSubdivided) {
            for (const child of this.childrenList) {
                child.resetSubdivisions();
            }
            this.isSubdivided = false;
        }
        this.visible = true;
    }

    public garbageCollect(): void {
        this.container.clear();

        if (this.children) {
            if (!this.isSubdivided) {
                for (const child of this.childrenList) {
                    child.dispose();
                }
                this.children = null;
            } else {
                for (const child of this.childrenList) {
                    child.garbageCollect();
                }
            }
        }
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
        this.isSubdivided = false;
    }

    public updateMesh(): void {
        this.container.clear();

        if (this.isSubdivided) {
            for (const child of this.childrenList) {
                child.updateMesh();
                this.container.add(child.container);
            }
        } else if (this.visible) {
            const edgesType = this.buildEdgesType();

            let mesh = this.meshes[edgesType.code];
            if (!mesh) {
                const geometryData = this.buildGeometryData(edgesType);

                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.positions, 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(geometryData.colors, 3));
                geometry.setIndex(geometryData.indices);
                geometry.computeVertexNormals();

                mesh = new THREE.Mesh(geometry, HeightmapNode.material);
                mesh.name = `Heightmap node mesh ${this.id.asString()}`;
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                const firstVoxelPosition = this.id.box.min;
                mesh.position.set(firstVoxelPosition.x, 0, firstVoxelPosition.y);
                this.meshes[edgesType.code] = mesh;
            }
            this.container.add(mesh);
        }
    }

    public getOrBuildSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        if (this.id.equals(nodeId)) {
            return this;
        } else if (nodeId.level >= this.id.level) {
            // node cannot be not a child of this
            return null;
        }

        if (this.id.contains(nodeId)) {
            if (!this.children || !this.isSubdivided) {
                this.split();
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

    public set visible(value: boolean) {
        this.container.visible = value;
    }

    public get visible(): boolean {
        return this.container.visible;
    }

    public getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null {
        if (this.id.equals(nodeId)) {
            return this;
        } else if (nodeId.level >= this.id.level) {
            // node cannot be not a child of this
            return null;
        }

        if (this.isSubdivided && this.id.contains(nodeId)) {
            for (const child of this.childrenList) {
                const result = child.getSubNode(nodeId);
                if (result) {
                    return result;
                }
            }
        }

        return null;
    }

    private split(): void {
        if (this.id.level <= 0) {
            logger.warn('Cannot split heightmap node');
            return;
        }

        this.isSubdivided = true;

        if (this.root) {
            this.root.getOrBuildSubNode(this.id.getNeighbour(-1, 0));
            this.root.getOrBuildSubNode(this.id.getNeighbour(+1, 0));
            this.root.getOrBuildSubNode(this.id.getNeighbour(0, -1));
            this.root.getOrBuildSubNode(this.id.getNeighbour(0, +1));
        }

        if (!this.children) {
            const childrenLevel = this.id.level - 1;
            const subLevelBaseCoords = new THREE.Vector2().copy(this.id.coordsInLevel).multiplyScalar(2);
            const root = this.root || this;

            const mmChildId = new HeightmapNodeId(childrenLevel, { x: subLevelBaseCoords.x, y: subLevelBaseCoords.y });
            this.children = {
                mm: new HeightmapNode(this.sampler, mmChildId, root),
                pm: new HeightmapNode(this.sampler, mmChildId.getNeighbour(1, 0), root),
                mp: new HeightmapNode(this.sampler, mmChildId.getNeighbour(0, 1), root),
                pp: new HeightmapNode(this.sampler, mmChildId.getNeighbour(1, 1), root),
            };
        }
    }

    private get childrenList(): HeightmapNode[] {
        if (!this.children) {
            throw new Error();
        }
        return Object.values(this.children);
    }

    private buildGeometryData(edgesType: EdgesType): GeometryData {
        const levelScaling = 1 << this.id.level;
        const voxelRatio = 2;
        const voxelsCount = HeightmapNodeId.smallestLevelSizeInVoxels;
        const quadsCount = voxelsCount / voxelRatio;
        const scaling = levelScaling * voxelRatio;

        const geometryData: number[] = [];
        const indexData: number[] = [];

        const buildInnerIndex = (x: number, y: number) => y + x * (quadsCount - 1);

        {
            // inner part
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
                    indexData.push(mm, pp, pm, mm, mp, pp);
                }
            }
        }

        {
            // outer part
            const mmCornerIndex = geometryData.length / 3;
            geometryData.push(0, 0, 0);

            const mpCornerIndex = geometryData.length / 3;
            geometryData.push(0, 0, scaling * quadsCount);

            const pmCornerIndex = geometryData.length / 3;
            geometryData.push(scaling * quadsCount, 0, 0);

            const ppCornerIndex = geometryData.length / 3;
            geometryData.push(scaling * quadsCount, 0, scaling * quadsCount);

            const buildEdge = (
                edgeType: EEdgeType,
                invertEdgeIfSimple: boolean,
                cornerIndex1: number,
                cornerIndex2: number,
                innerFrom: THREE.Vector2Like,
                innerTo: THREE.Vector2Like,
                margin: THREE.Vector2Like
            ) => {
                const innerIndices: number[] = [buildInnerIndex(innerFrom.x, innerFrom.y)];
                {
                    const innerStepsCount = quadsCount - 2;
                    const innerStep = { x: (innerTo.x - innerFrom.x) / innerStepsCount, y: (innerTo.y - innerFrom.y) / innerStepsCount };
                    for (let i = 1; i <= innerStepsCount - 1; i++) {
                        innerIndices.push(buildInnerIndex(innerFrom.x + i * innerStep.x, innerFrom.y + i * innerStep.y));
                    }
                    innerIndices.push(buildInnerIndex(innerTo.x, innerTo.y));
                }

                const outerIndices: number[] = [];
                {
                    const outerFrom = { x: geometryData[3 * cornerIndex1]!, y: geometryData[3 * cornerIndex1 + 2]! };
                    const outerTo = { x: geometryData[3 * cornerIndex2]!, y: geometryData[3 * cornerIndex2 + 2]! };

                    const outerStepsCount = edgeType === EEdgeType.TESSELATED ? 2 * quadsCount : quadsCount;

                    const dX = edgeType === EEdgeType.LIMIT ? 2 * margin.x : 0;
                    const dY = edgeType === EEdgeType.LIMIT ? -1 : 0;
                    const dZ = edgeType === EEdgeType.LIMIT ? 2 * margin.y : 0;

                    outerIndices.push(cornerIndex1);
                    const outerStep = { x: (outerTo.x - outerFrom.x) / outerStepsCount, y: (outerTo.y - outerFrom.y) / outerStepsCount };
                    for (let i = 1; i <= outerStepsCount - 1; i++) {
                        outerIndices.push(geometryData.length / 3);
                        geometryData.push(outerFrom.x + i * outerStep.x + dX, dY, outerFrom.y + i * outerStep.y + dZ);
                    }
                    outerIndices.push(cornerIndex2);
                }

                if (edgeType === EEdgeType.TESSELATED) {
                    indexData.push(outerIndices[0]!, innerIndices[0]!, outerIndices[1]!);
                    for (let i = 0; i < innerIndices.length; i++) {
                        indexData.push(outerIndices[1 + 2 * i]!, innerIndices[i]!, outerIndices[2 + 2 * i]!);
                        if (i < innerIndices.length - 1) {
                            indexData.push(innerIndices[i]!, innerIndices[i + 1]!, outerIndices[3 + 2 * i]!);
                        }
                        indexData.push(outerIndices[2 + 2 * i]!, innerIndices[i]!, outerIndices[3 + 2 * i]!);
                    }
                    indexData.push(
                        outerIndices[outerIndices.length - 2]!,
                        innerIndices[innerIndices.length - 1]!,
                        outerIndices[outerIndices.length - 1]!
                    );
                } else {
                    if (invertEdgeIfSimple) {
                        innerIndices.reverse();
                        outerIndices.reverse();

                        indexData.push(outerIndices[1]!, innerIndices[0]!, outerIndices[0]!);
                        for (let i = 0; i < innerIndices.length - 1; i++) {
                            indexData.push(innerIndices[i + 1]!, innerIndices[i]!, outerIndices[i + 1]!);
                            indexData.push(innerIndices[i + 1]!, outerIndices[i + 1]!, outerIndices[i + 2]!);
                        }
                        indexData.push(
                            outerIndices[outerIndices.length - 1]!,
                            innerIndices[innerIndices.length - 1]!,
                            outerIndices[outerIndices.length - 2]!
                        );
                    } else {
                        indexData.push(outerIndices[0]!, innerIndices[0]!, outerIndices[1]!);
                        for (let i = 0; i < innerIndices.length - 1; i++) {
                            indexData.push(innerIndices[i]!, innerIndices[i + 1]!, outerIndices[i + 1]!);
                            indexData.push(innerIndices[i + 1]!, outerIndices[i + 2]!, outerIndices[i + 1]!);
                        }
                        indexData.push(
                            outerIndices[outerIndices.length - 2]!,
                            innerIndices[innerIndices.length - 1]!,
                            outerIndices[outerIndices.length - 1]!
                        );
                    }
                }
            };

            buildEdge(edgesType.down, false, mmCornerIndex, pmCornerIndex, { x: 0, y: 0 }, { x: quadsCount - 2, y: 0 }, { x: 0, y: -1 });
            buildEdge(
                edgesType.right,
                true,
                pmCornerIndex,
                ppCornerIndex,
                { x: quadsCount - 2, y: 0 },
                { x: quadsCount - 2, y: quadsCount - 2 },
                { x: 1, y: 0 }
            );
            buildEdge(
                edgesType.up,
                false,
                ppCornerIndex,
                mpCornerIndex,
                { x: quadsCount - 2, y: quadsCount - 2 },
                { x: 0, y: quadsCount - 2 },
                { x: 0, y: 1 }
            );
            buildEdge(edgesType.left, true, mpCornerIndex, mmCornerIndex, { x: 0, y: quadsCount - 2 }, { x: 0, y: 0 }, { x: -1, y: 0 });
        }

        const colorData: number[] = [];
        {
            // post-processing: altitude, colors
            for (let i = 0; i < geometryData.length; i += 3) {
                const x = geometryData[i]! + this.id.box.min.x;
                const y = geometryData[i + 2]! + this.id.box.min.y;

                const mapSample = this.sampler.sampleHeightmap(x, y);
                geometryData[i + 1] += mapSample.altitude;

                colorData.push(mapSample.color.r, mapSample.color.g, mapSample.color.b);
            }
        }

        return { positions: geometryData, indices: indexData, colors: colorData };
    }

    private buildEdgesType(): EdgesType {
        const getEdge = (dX: number, dY: number) => {
            const neighbourId = new HeightmapNodeId(this.id.level, { x: this.id.coordsInLevel.x + dX, y: this.id.coordsInLevel.y + dY });
            const neighbour = this.root.getSubNode(neighbourId);
            if (neighbour) {
                if (neighbour.isSubdivided) {
                    return EEdgeType.TESSELATED;
                }

                if (!neighbour.visible) {
                    return EEdgeType.LIMIT;
                }
            }
            return EEdgeType.SIMPLE;
        };

        const up = getEdge(0, +1);
        const down = getEdge(0, -1);
        const left = getEdge(-1, 0);
        const right = getEdge(+1, 0);

        const code = +up + (+down << 2) + (+left << 4) + (+right << 6);
        return { up, down, left, right, code };
    }
}

export { HeightmapNode, type HeightmapSampler };
