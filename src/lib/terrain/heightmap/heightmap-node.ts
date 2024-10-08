import * as THREE from '../../libs/three-usage';
import { processAsap, type SyncOrPromise } from '../../helpers/async/async-sync';
import { DisposableMap } from '../../helpers/disposable-map';
import { logger } from '../../helpers/logger';
import { createMeshesStatistics, type MeshesStatistics } from '../../helpers/meshes-statistics';

import { EEdgeResolution, type HeightmapNodeGeometry } from './heightmap-node-geometry';
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
    DECIMATED = 1,
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
    readonly basePatchSize: number;
    readonly material: THREE.Material;
    readonly nodeGeometry: HeightmapNodeGeometry;

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
            mesh.updateWorldMatrix(false, false);
            return mesh;
        });
    }

    private buildGeometryData(edgesType: EdgesType): SyncOrPromise<GeometryData> {
        const scaling = this.root.nodeGeometry.baseScaling << this.id.level;

        let template = this.template;
        if (!template) {
            const positionsBuffer = this.root.nodeGeometry.clonePositionsBuffer();

            const sampleCoords: IHeightmapCoords[] = [];
            for (let i = 0; i < positionsBuffer.length; i += 3) {
                positionsBuffer[i]! *= scaling;
                positionsBuffer[i + 2]! *= scaling;

                sampleCoords.push({
                    x: positionsBuffer[i]! + this.id.box.min.x,
                    z: positionsBuffer[i + 2]! + this.id.box.min.y,
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
                positionsBuffer,
            };
            this.template = template;
        }

        const positionsBuffer = new Float32Array(template.positionsBuffer);

        const indices = this.root.nodeGeometry.getIndices({
            up: edgesType.up === EEdgeType.DECIMATED ? EEdgeResolution.DECIMATED : EEdgeResolution.SIMPLE,
            down: edgesType.down === EEdgeType.DECIMATED ? EEdgeResolution.DECIMATED : EEdgeResolution.SIMPLE,
            left: edgesType.left === EEdgeType.DECIMATED ? EEdgeResolution.DECIMATED : EEdgeResolution.SIMPLE,
            right: edgesType.right === EEdgeType.DECIMATED ? EEdgeResolution.DECIMATED : EEdgeResolution.SIMPLE,
        });

        const limitDrop = -20;
        const marginSize = 2;

        const applyCornerLimit = (cornerType: ECornerType, cornerIndex: number) => {
            if (cornerType === ECornerType.LIMIT) {
                positionsBuffer[3 * cornerIndex + 1]! = limitDrop;
            }
        };
        applyCornerLimit(edgesType.upLeft, indices.corners.upLeft);
        applyCornerLimit(edgesType.upRight, indices.corners.upRight);
        applyCornerLimit(edgesType.downRight, indices.corners.downRight);
        applyCornerLimit(edgesType.downLeft, indices.corners.downLeft);

        const applyEdgeLimit = (edgeType: EEdgeType, edgeIndices: ReadonlyArray<number>, margin: THREE.Vector2Like) => {
            if (edgeType === EEdgeType.LIMIT) {
                for (const index of edgeIndices) {
                    positionsBuffer[3 * index + 0]! += marginSize * margin.x;
                    positionsBuffer[3 * index + 1]! = limitDrop;
                    positionsBuffer[3 * index + 0]! += marginSize * margin.y;
                }
            }
        };
        applyEdgeLimit(edgesType.up, indices.edges.up, { x: 0, y: 1 });
        applyEdgeLimit(edgesType.down, indices.edges.down, { x: 0, y: -1 });
        applyEdgeLimit(edgesType.right, indices.edges.right, { x: 1, y: 0 });
        applyEdgeLimit(edgesType.left, indices.edges.left, { x: -1, y: 0 });

        return processAsap(template.heightmapSamples, samples => {
            for (let i = 0; i < samples.altitudes.length; i++) {
                const sampleAltitude = samples.altitudes[i]!;
                positionsBuffer[3 * i + 1]! += sampleAltitude;
            }

            return { positions: positionsBuffer, indices: indices.buffer, colors: samples.colorsBuffer };
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
                if (!neighbour.visible) {
                    return EEdgeType.LIMIT;
                }
                return EEdgeType.SIMPLE;
            }
            return EEdgeType.DECIMATED;
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
