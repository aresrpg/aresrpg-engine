import { PropsViewer } from '../../../effects/props/props-viewer';
import { PromisesQueue } from '../../../helpers/async/promises-queue';
import { logger } from '../../../helpers/logger';
import { vec3ToString } from '../../../helpers/string';
import * as THREE from '../../../libs/three-usage';
import { ChunkId } from '../chunk/chunk-id';
import { type IClutterDefinition, type IVoxelMap, type VoxelsChunkSize } from '../i-voxelmap';
import { type VoxelsChunkData } from '../viewer/voxelmap-viewer';

import { ClutterComputer } from './clutter-computer';
import { ClutterComputerWorker } from './clutter-computer-worker';

enum EComputationResult {
    SKIPPED = 'skipped',
    CANCELLED = 'cancelled',
    FINISHED = 'finished',
}

type Parameters = {
    readonly map: IVoxelMap;
    readonly chunkSize: VoxelsChunkSize;
    readonly computationOptions:
        | {
              readonly method: 'main-thread';
          }
        | {
              readonly method: 'worker';
              readonly threadsCount: number;
          };
};

type ClutterChunk = {
    hasLatestData: boolean;
    lastComputationId: symbol;
};

class ClutterViewer {
    public readonly container: THREE.Object3D;

    public readonly chunkSize: VoxelsChunkSize;
    private readonly chunkSizeVec3: THREE.Vector3Like;

    private readonly propsViewers: ReadonlyArray<PropsViewer>;

    private readonly promiseThrottler: PromisesQueue;
    private readonly computer: ClutterComputer;

    private readonly clutterChunks = new Map<string, ClutterChunk>();

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'clutter-viewer';

        this.chunkSize = params.chunkSize;
        this.chunkSizeVec3 = { x: params.chunkSize.xz, y: params.chunkSize.y, z: params.chunkSize.xz };

        this.propsViewers = params.map.voxelTypesDefininitions.clutterVoxels.map((clutterDefinition: IClutterDefinition, id: number) => {
            let bufferGeometry: THREE.BufferGeometry;
            let material: THREE.MeshPhongMaterial;

            if (clutterDefinition.type === 'grass-2d') {
                const w = clutterDefinition.width;
                const h = clutterDefinition.height;
                bufferGeometry = new THREE.BufferGeometry();
                bufferGeometry.setAttribute(
                    'position',
                    new THREE.Float32BufferAttribute(
                        [
                            -0.5 * w,
                            0,
                            0,
                            0.5 * w,
                            0,
                            0,
                            0.5 * w,
                            h,
                            0,
                            -0.5 * w,
                            0,
                            0,
                            0.5 * w,
                            h,
                            0,
                            -0.5 * w,
                            h,
                            0,
                            0,
                            0,
                            -0.5 * w,
                            0,
                            0,
                            0.5 * w,
                            0,
                            h,
                            0.5 * w,
                            0,
                            0,
                            -0.5 * w,
                            0,
                            h,
                            0.5 * w,
                            0,
                            h,
                            -0.5 * w,
                        ],
                        3
                    )
                );
                bufferGeometry.setAttribute(
                    'uv',
                    new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2)
                );
                bufferGeometry.computeVertexNormals();

                material = new THREE.MeshPhongMaterial({
                    map: clutterDefinition.texture,
                    alphaTest: 0.95,
                    side: THREE.DoubleSide,
                });
            } else {
                throw new Error(`Unknown clutter type "${clutterDefinition.type}".`);
            }
            const propsViewer = new PropsViewer({
                bufferGeometry,
                material,
                reactToWind: true,
                chunkSize: { x: params.chunkSize.xz, y: params.chunkSize.y, z: params.chunkSize.xz },
                garbageCollect: {
                    interval: -1, // no garbage collecting
                },
            });
            propsViewer.container.name = `clutter-viewer-${id}`;
            this.container.add(propsViewer.container);
            return propsViewer;
        });

        let threadsCount: number;
        if (params.computationOptions.method === 'main-thread') {
            this.computer = new ClutterComputer();
            threadsCount = 1;
        } else {
            this.computer = new ClutterComputerWorker({ workersPoolSize: params.computationOptions.threadsCount });
            threadsCount = params.computationOptions.threadsCount;
        }

        this.promiseThrottler = new PromisesQueue(threadsCount);
    }

    public dispose(): void {
        this.container.clear();
        for (const propsViewer of this.propsViewers) {
            propsViewer.dispose();
        }
    }

    public setChunkPropsFromWorldMatrices(
        chunkId: THREE.Vector3Like,
        clutterId: number,
        worldMatricesList: ReadonlyArray<THREE.Matrix4>
    ): void {
        this.getPropsViewer(clutterId).setChunkPropsFromWorldMatrices(chunkId, worldMatricesList);
    }

    public async enqueueChunk(id: THREE.Vector3Like, voxelsChunkData: VoxelsChunkData): Promise<EComputationResult> {
        const voxelsChunkInnerSize = voxelsChunkData.size.clone().subScalar(2);
        if (!voxelsChunkInnerSize.equals(this.chunkSizeVec3)) {
            throw new Error(`Invalid voxels chunk size ${vec3ToString(voxelsChunkData.size)}.`);
        }

        const chunkId = new ChunkId(id);
        let clutterChunk = this.clutterChunks.get(chunkId.asString);
        if (!clutterChunk) {
            clutterChunk = { hasLatestData: false, lastComputationId: Symbol('clutter') };
            this.clutterChunks.set(chunkId.asString, clutterChunk);
        }
        if (clutterChunk.hasLatestData) {
            logger.debug(`Skipping unnecessary computation of up-do-date clutter chunk "${chunkId.asString}".`);
            return EComputationResult.SKIPPED;
        }

        const computationId = Symbol('clutter');
        clutterChunk.hasLatestData = true;
        clutterChunk.lastComputationId = computationId;

        if (voxelsChunkData.isEmpty) {
            for (const propsViewer of this.propsViewers) {
                propsViewer.setChunkPropsFromWorldMatrices(chunkId, []);
            }
            return EComputationResult.FINISHED;
        }

        return await new Promise<EComputationResult>(resolve => {
            this.promiseThrottler
                .run(
                    async () => {
                        if (this.clutterChunks.get(chunkId.asString)?.lastComputationId !== computationId) {
                            logger.debug(`Computation of clutter chunk "${chunkId.asString}" was cancelled before it started.`);
                            return EComputationResult.CANCELLED;
                        }

                        const chunkOrigin = new THREE.Vector3().multiplyVectors(this.chunkSizeVec3, id);
                        const chunkClutter = await this.computer.computeChunkClutter(chunkOrigin, voxelsChunkData);

                        if (this.clutterChunks.get(chunkId.asString)?.lastComputationId !== computationId) {
                            logger.debug(`Computation of clutter chunk "${chunkId.asString}" was cancelled during its run.`);
                            return EComputationResult.CANCELLED;
                        }

                        for (const [clutterId, matrices] of chunkClutter.entries()) {
                            this.getPropsViewer(clutterId).setChunkPropsFromWorldMatrices(chunkId, matrices);
                        }
                        return EComputationResult.FINISHED;
                    },
                    () => {
                        const latestClutterChunk = this.clutterChunks.get(chunkId.asString);
                        if (latestClutterChunk && latestClutterChunk.lastComputationId === computationId) {
                            latestClutterChunk.hasLatestData = false;
                            latestClutterChunk.lastComputationId = Symbol('clutter');
                        }
                        resolve(EComputationResult.CANCELLED);
                    }
                )
                .then(resolve);
        });
    }

    public purgeQueue(): void {
        this.promiseThrottler.cancelAll();
    }

    public dequeueChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        const clutterChunk = this.clutterChunks.get(chunkId.asString);
        if (clutterChunk) {
            clutterChunk.lastComputationId = Symbol('clutter');
        }
    }

    public invalidateChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        const clutterChunk = this.clutterChunks.get(chunkId.asString);
        if (clutterChunk) {
            clutterChunk.hasLatestData = false;
        }
    }

    public deleteChunk(id: THREE.Vector3Like): void {
        const chunkId = new ChunkId(id);
        this.clutterChunks.delete(chunkId.asString);
        for (const propsViewer of this.propsViewers) {
            if (propsViewer.hasChunkProps(chunkId)) {
                propsViewer.deleteChunkProps(chunkId);
            }
        }
    }

    private getPropsViewer(clutterId: number): PropsViewer {
        const propsViewer = this.propsViewers[clutterId];
        if (!propsViewer) {
            throw new Error(`Unknown clutter id "${clutterId}".`);
        }
        return propsViewer;
    }
}

export { ClutterViewer };
