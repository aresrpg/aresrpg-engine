import { processAsap, type SyncOrPromise } from '../../helpers/async-sync';
import { DisposableMap } from '../../helpers/disposable-map';
import { logger } from '../../helpers/logger';
import { createMeshesStatistics, type MeshesStatistics } from '../../helpers/meshes-statistics';
import * as THREE from '../../three-usage';

import { HeightmapNodeId } from './heightmap-node-id';
import { HeightmapNodeMesh } from './heightmap-node-mesh';
import { type IHeightmap, type IHeightmapCoords } from './i-heightmap';

type Children = {
    readonly mm: HeightmapNode;
    readonly mp: HeightmapNode;
    readonly pm: HeightmapNode;
    readonly pp: HeightmapNode;
};

type GeometryData = {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly indices: number[];
};

enum EEdgeType {
    SIMPLE = 0,
    TESSELATED = 1,
    LIMIT = 2,
}

enum ECornerType {
    SIMPLE = 0,
    LIMIT = 1,
}

type EdgesType = {
    readonly up: EEdgeType;
    readonly down: EEdgeType;
    readonly left: EEdgeType;
    readonly right: EEdgeType;
    readonly upLeft: ECornerType;
    readonly upRight: ECornerType;
    readonly downLeft: ECornerType;
    readonly downRight: ECornerType;
    readonly code: number;
};

interface IHeightmapRoot {
    readonly smallestLevelSizeInVoxels: number;
    readonly material: THREE.Material;

    getOrBuildSubNode(nodeId: HeightmapNodeId): HeightmapNode | null;
    getSubNode(nodeId: HeightmapNodeId): HeightmapNode | null;
}

type ProcessedHeightmapSamples = {
    readonly altitudes: ReadonlyArray<number>;
    readonly colorsBuffer: Float32Array;
};

type NodeGeometryTemplate = {
    readonly positionsBuffer: Float32Array;
    readonly heightmapSamples: SyncOrPromise<ProcessedHeightmapSamples>;
};

class HeightmapNode {
    public readonly container: THREE.Object3D;

    private nodeMeshes = new DisposableMap<HeightmapNodeMesh>();
    private children: Children | null = null;
    private isSubdivided: boolean = false;

    private selfTrianglesCount: number = 0;
    private selfGpuMemoryBytes: number = 0;

    private readonly sampler: IHeightmap;
    private readonly root: IHeightmapRoot;
    private readonly id: HeightmapNodeId;

    private template: NodeGeometryTemplate | null = null;

    public constructor(sampler: IHeightmap, id: HeightmapNodeId, root: IHeightmapRoot) {
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

        this.nodeMeshes.clear();

        this.selfTrianglesCount = 0;
        this.selfGpuMemoryBytes = 0;

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

            let nodeMesh = this.nodeMeshes.getItem(edgesType.code);
            if (!nodeMesh) {
                const meshPromise = this.buildMesh(edgesType);
                nodeMesh = new HeightmapNodeMesh(meshPromise);
                this.nodeMeshes.setItem(edgesType.code, nodeMesh);
            }
            nodeMesh.attachTo(this.container);
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

    public getStatistics(): MeshesStatistics {
        const result = createMeshesStatistics();

        result.meshes.loadedCount += this.nodeMeshes.itemsCount;
        result.triangles.loadedCount += this.selfTrianglesCount;
        result.gpuMemoryBytes += this.selfGpuMemoryBytes;

        if (this.visible) {
            const trianglesCounts = this.nodeMeshes.allItems.map(mesh => mesh.trianglesCountInScene).filter(count => count > 0);
            if (trianglesCounts.length > 1) {
                logger.warn(`Heightmap node has more that 1 mesh for itself.`);
            }

            result.meshes.visibleCount += trianglesCounts.length;
            result.triangles.visibleCount += trianglesCounts.reduce((total, count) => total + count);
        }

        if (this.children) {
            for (const child of this.childrenList) {
                const childStatistics = child.getStatistics();

                result.meshes.loadedCount += childStatistics.meshes.loadedCount;
                result.triangles.loadedCount += childStatistics.triangles.loadedCount;

                result.gpuMemoryBytes += childStatistics.gpuMemoryBytes;

                if (this.visible) {
                    result.meshes.visibleCount += childStatistics.meshes.visibleCount;
                    result.triangles.visibleCount += childStatistics.triangles.visibleCount;
                }
            }
        }

        return result;
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

            const mmChildId = new HeightmapNodeId(childrenLevel, { x: subLevelBaseCoords.x, y: subLevelBaseCoords.y }, this.root);
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

    private buildMesh(edgesType: EdgesType): SyncOrPromise<THREE.Mesh> {
        const geometryDataResult = this.buildGeometryData(edgesType);

        return processAsap(geometryDataResult, geometryData => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(geometryData.positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(geometryData.colors, 3));
            geometry.setIndex(geometryData.indices);
            geometry.computeVertexNormals();

            this.selfTrianglesCount += geometryData.indices.length / 3;
            for (const attribute of Object.values(geometry.attributes)) {
                this.selfGpuMemoryBytes += attribute.array.byteLength;
            }
            this.selfGpuMemoryBytes += geometry.getIndex()!.array.byteLength;

            const mesh = new THREE.Mesh(geometry, this.root.material);
            mesh.name = `Heightmap node mesh ${this.id.asString()}`;
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            const firstVoxelPosition = this.id.box.min;
            mesh.position.set(firstVoxelPosition.x, 0, firstVoxelPosition.y);
            return mesh;
        });
    }

    private buildGeometryData(edgesType: EdgesType): SyncOrPromise<GeometryData> {
        const levelScaling = 1 << this.id.level;
        const voxelRatio = 2;
        const voxelsCount = this.root.smallestLevelSizeInVoxels;
        const quadsCount = voxelsCount / voxelRatio;
        const scaling = levelScaling * voxelRatio;

        let template = this.template;
        if (!template) {
            const geometryData: number[] = [];
            for (let i = 0; i <= quadsCount; i += 0.5) {
                // top edge
                geometryData.push(i * scaling, 0, quadsCount * scaling);
            }
            for (let i = quadsCount - 0.5; i >= 0; i -= 0.5) {
                // right edge
                geometryData.push(quadsCount * scaling, 0, i * scaling);
            }
            for (let i = quadsCount - 0.5; i >= 0; i -= 0.5) {
                // bottom edge
                geometryData.push(i * scaling, 0, 0);
            }
            for (let i = 0.5; i < quadsCount; i += 0.5) {
                // left edge
                geometryData.push(0, 0, i * scaling);
            }
            for (let iZ = 1; iZ <= quadsCount - 1; iZ++) {
                for (let iX = 1; iX <= quadsCount - 1; iX++) {
                    geometryData.push(iX * scaling, 0, iZ * scaling);
                }
            }

            const sampleCoords: IHeightmapCoords[] = [];
            for (let i = 0; i < geometryData.length; i += 3) {
                sampleCoords.push({
                    x: geometryData[i]! + this.id.box.min.x,
                    z: geometryData[i + 2]! + this.id.box.min.y,
                });
            }

            const samplingResults = this.sampler.sampleHeightmap(sampleCoords);
            const processedSamples = processAsap(samplingResults, samples => {
                const altitudes: number[] = [];
                const colors: number[] = [];
                for (const sample of samples) {
                    altitudes.push(sample.altitude);
                    colors.push(sample.color.r, sample.color.g, sample.color.b);
                }

                return {
                    altitudes,
                    colorsBuffer: new Float32Array(colors),
                };
            });

            template = {
                heightmapSamples: processedSamples,
                positionsBuffer: new Float32Array(geometryData),
            };
            this.template = template;
        }

        const buildInnerIndex = (x: number, y: number) => 4 * 2 * quadsCount + x + y * (quadsCount - 1);

        const indexData: number[] = [];
        for (let iX = 0; iX < quadsCount - 2; iX++) {
            for (let iY = 0; iY < quadsCount - 2; iY++) {
                const mm = buildInnerIndex(iX + 0, iY + 0);
                const mp = buildInnerIndex(iX + 0, iY + 1);
                const pm = buildInnerIndex(iX + 1, iY + 0);
                const pp = buildInnerIndex(iX + 1, iY + 1);
                indexData.push(mm, pp, pm, mm, mp, pp);
            }
        }

        const limitDrop = -20;
        const marginSize = 2;

        const positionsBuffer = new Float32Array(template.positionsBuffer);

        const buildEdge = (
            edgeType: EEdgeType,
            edgeIndexFrom: number,
            innerIndexFrom: number,
            innerIndexStep: number,
            invert: boolean,
            margin: THREE.Vector2Like
        ) => {
            if (edgeType === EEdgeType.TESSELATED) {
                for (let iEdge = 0; iEdge < 2 * quadsCount; iEdge += 2) {
                    const iEdgeIndex = edgeIndexFrom + iEdge;
                    const e1 = iEdgeIndex;
                    const e2 = iEdgeIndex + 1;
                    const e3 = (iEdgeIndex + 2) % (8 * quadsCount);

                    if (iEdge === 0 || iEdge === 2 * quadsCount - 2) {
                        const i1 = iEdge === 0 ? innerIndexFrom : innerIndexFrom + (quadsCount - 2) * innerIndexStep;
                        indexData.push(e1, e2, i1, e2, e3, i1);
                    } else {
                        const i1 = innerIndexFrom + (iEdge / 2 - 1) * innerIndexStep;
                        const i2 = i1 + innerIndexStep;
                        indexData.push(i1, e1, e2, i1, e2, i2, e2, e3, i2);
                    }
                }
            } else {
                for (let iEdge = 0; iEdge < 2 * quadsCount; iEdge += 2) {
                    const iEdgeIndex = edgeIndexFrom + iEdge;
                    const e1 = iEdgeIndex;
                    const e2 = (iEdgeIndex + 2) % (8 * quadsCount);

                    if (iEdge === 0 || iEdge === 2 * quadsCount - 2) {
                        const i1 = iEdge === 0 ? innerIndexFrom : innerIndexFrom + (quadsCount - 2) * innerIndexStep;
                        indexData.push(e1, e2, i1);
                    } else {
                        const i1 = innerIndexFrom + (iEdge / 2) * innerIndexStep;
                        const i2 = i1 - innerIndexStep;

                        if (invert) {
                            indexData.push(i2, e1, e2, e2, i1, i2);
                        } else {
                            indexData.push(e1, e2, i1, e1, i1, i2);
                        }
                    }
                }
            }

            if (edgeType === EEdgeType.LIMIT) {
                for (let iEdge = 0; iEdge <= 2 * quadsCount; iEdge++) {
                    const iEdgeIndex = (edgeIndexFrom + iEdge) % (8 * quadsCount);
                    positionsBuffer[3 * iEdgeIndex + 0]! += marginSize * margin.x;
                    positionsBuffer[3 * iEdgeIndex + 1]! = limitDrop;
                    positionsBuffer[3 * iEdgeIndex + 0]! += marginSize * margin.y;
                }
            }
        };

        const mpIndex = 0 * (2 * quadsCount);
        const ppIndex = 1 * (2 * quadsCount);
        const pmIndex = 2 * (2 * quadsCount);
        const mmIndex = 3 * (2 * quadsCount);

        buildEdge(edgesType.up, mpIndex, buildInnerIndex(0, quadsCount - 2), 1, true, { x: 0, y: 1 });
        buildEdge(edgesType.right, ppIndex, buildInnerIndex(quadsCount - 2, quadsCount - 2), -(quadsCount - 1), false, { x: 1, y: 0 });
        buildEdge(edgesType.down, pmIndex, buildInnerIndex(quadsCount - 2, 0), -1, true, { x: 0, y: -1 });
        buildEdge(edgesType.left, mmIndex, buildInnerIndex(0, 0), quadsCount - 1, false, { x: -1, y: 0 });

        if (edgesType.upLeft === ECornerType.LIMIT) {
            positionsBuffer[3 * mpIndex + 1]! = limitDrop;
        }
        if (edgesType.upRight === ECornerType.LIMIT) {
            positionsBuffer[3 * ppIndex + 1]! = limitDrop;
        }
        if (edgesType.downRight === ECornerType.LIMIT) {
            positionsBuffer[3 * pmIndex + 1]! = limitDrop;
        }
        if (edgesType.downLeft === ECornerType.LIMIT) {
            positionsBuffer[3 * mmIndex + 1]! = limitDrop;
        }

        return processAsap(template.heightmapSamples, samples => {
            for (let i = 0; i < samples.altitudes.length; i++) {
                const sampleAltitude = samples.altitudes[i]!;
                positionsBuffer[3 * i + 1]! += sampleAltitude;
            }

            return { positions: positionsBuffer, indices: indexData, colors: samples.colorsBuffer };
        });
    }

    private buildEdgesType(): EdgesType {
        const getNeighbour = (dX: number, dY: number) => {
            const neighbourId = new HeightmapNodeId(
                this.id.level,
                { x: this.id.coordsInLevel.x + dX, y: this.id.coordsInLevel.y + dY },
                this.root
            );
            return this.root.getSubNode(neighbourId);
        };

        const getEdge = (dX: number, dY: number) => {
            const neighbour = getNeighbour(dX, dY);
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

        const getCorner = (dX: number, dY: number) => {
            const neighbour = getNeighbour(dX, dY);
            if (neighbour && !neighbour.visible) {
                return ECornerType.LIMIT;
            }
            return ECornerType.SIMPLE;
        };

        const up = getEdge(0, +1);
        const down = getEdge(0, -1);
        const left = getEdge(-1, 0);
        const right = getEdge(+1, 0);

        const upLeft = getCorner(-1, +1);
        const upRight = getCorner(+1, +1);
        const downLeft = getCorner(-1, -1);
        const downRight = getCorner(+1, -1);

        const code =
            +up + (+down << 2) + (+left << 4) + (+right << 6) + (+upLeft << 8) + (+upRight << 10) + (+downLeft << 12) + (+downRight << 14);
        return { up, down, left, right, upLeft, upRight, downLeft, downRight, code };
    }
}

export { HeightmapNode };
