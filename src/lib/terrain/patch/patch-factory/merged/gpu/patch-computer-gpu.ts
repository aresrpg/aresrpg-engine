/// <reference types="@webgpu/types" />

import * as THREE from 'three';

import { logger } from '../../../../../helpers/logger';
import { getGpuDevice } from '../../../../../helpers/webgpu/webgpu-device';
import * as Cube from '../../cube';
import { type LocalMapCache } from '../../patch-factory-base';
import { VertexData1Encoder } from '../vertex-data1-encoder';
import { VertexData2Encoder } from '../vertex-data2-encoder';

type FaceBuffer = {
    readonly storageBuffer: GPUBuffer;
    readonly readableBuffer: GPUBuffer;
};

type ComputationOutputs = Uint32Array;

class PatchComputerGpu {
    public static async create(localCacheSize: THREE.Vector3, vertexData1Encoder: VertexData1Encoder, vertexData2Encoder: VertexData2Encoder): Promise<PatchComputerGpu> {
        logger.debug('Requesting WebGPU device...');
        const device = await getGpuDevice();
        return new PatchComputerGpu(device, localCacheSize, vertexData1Encoder, vertexData2Encoder);
    }

    private readonly device: GPUDevice;

    private readonly computePipeline: GPUComputePipeline;
    private readonly computePipelineBindgroup: GPUBindGroup;
    private readonly localCacheBuffer: GPUBuffer;
    private readonly buffer: FaceBuffer;

    private readonly workgroupSize = 256;

    private constructor(device: GPUDevice, localCacheSize: THREE.Vector3, vertexData1Encoder: VertexData1Encoder, vertexData2Encoder: VertexData2Encoder) {
        this.device = device;

        const code = `
        struct LocalMapCacheBuffer {
            size: vec3i,
            data: array<u32>,
        };
        struct VerticesBuffer {
            verticesCount: atomic<u32>,
            verticesData: array<u32>,
        };
        @group(0) @binding(0) var<storage,read> localMapCacheData: LocalMapCacheBuffer;
        @group(0) @binding(1) var<storage,read_write> verticesBuffer: VerticesBuffer;
        struct ComputeIn {
            @builtin(global_invocation_id) globalInvocationId : vec3u,
        };
        
        fn sampleLocalCache(index: i32) -> u32 {
            let actualIndex = index / 2;
            let data = localMapCacheData.data[actualIndex];
            if (index % 2 == 0) {
                return data & ${(1 << 16) - 1};
            } else {
                return data >> 16;
            }
        }
        fn buildCacheIndex(coords: vec3i) -> i32 {
            return coords.x + localMapCacheData.size.x * (coords.y + localMapCacheData.size.y * coords.z);
        }
        fn doesNeighbourExist(voxelCacheIndex: i32, neighbourRelativePosition: vec3i) -> bool {
            let neighbourCacheIndex = voxelCacheIndex + buildCacheIndex(neighbourRelativePosition);
            let neighbourData = sampleLocalCache(neighbourCacheIndex);
            return neighbourData != 0u;
        }
        fn encodeVoxelData1(voxelPosition: vec3u) -> u32 {
            return ${vertexData1Encoder.wgslEncodeVoxelData('voxelPosition')};
        }
        fn encodeVertexData1(encodedVoxelPosition: u32, verticePosition: vec3u, ao: u32, edgeRoundnessX: u32, edgeRoundnessY: u32) -> u32 {
            return encodedVoxelPosition + ${vertexData1Encoder.wgslEncodeVertexData('verticePosition', 'ao', 'edgeRoundnessX', 'edgeRoundnessY')};
        }
        fn encodeVoxelData2(voxelMaterialId: u32, faceNoiseId: u32, normalId: u32, uvRightId: u32) -> u32 {
            return ${vertexData2Encoder.wgslEncodeVoxelData('voxelMaterialId', 'faceNoiseId', 'normalId', 'uvRightId')};
        }

        @compute @workgroup_size(${this.workgroupSize})
        fn main(in: ComputeIn) {
            let globalInvocationId: u32 = in.globalInvocationId.x;
            if (globalInvocationId == 0u) {
                atomicStore(&verticesBuffer.verticesCount, 0u);
            }
            storageBarrier();
            let patchIndex: u32 = globalInvocationId;
        
            let patchSize: vec3u = vec3u(localMapCacheData.size) - 2u;
        
            let voxelLocalPosition = vec3u(
                patchIndex % patchSize.x,
                (patchIndex / patchSize.x) % patchSize.y,
                patchIndex / (patchSize.x * patchSize.y)
            );
            if (voxelLocalPosition.z < patchSize.z) { // if we are in the patch
                let cacheCoords = vec3i(voxelLocalPosition + 1u);
                let cacheIndex: i32 = buildCacheIndex(cacheCoords);
                let voxelData: u32 = sampleLocalCache(cacheIndex);
                if (voxelData != 0u) {
                    let voxelMaterialId: u32 = voxelData - 1u;
                    let encodedVoxelPosition = ${vertexData1Encoder.wgslEncodeVoxelData('voxelLocalPosition')};
                    ${Object.values(Cube.faces)
                .map(
                    face => `
                    if (!doesNeighbourExist(cacheIndex, vec3i(${face.normal.vec.x}, ${face.normal.vec.y}, ${face.normal.vec.z}))) {
                        let firstVertexIndex: u32 = atomicAdd(&verticesBuffer.verticesCount, 6u);
                        let faceNoiseId: u32 = (firstVertexIndex / 6u) % (${vertexData2Encoder.faceNoiseId.maxValue});
                        var ao: u32;
                        var edgeRoundnessX: bool;
                        var edgeRoundnessY: bool;
                        ${face.vertices
                            .map(
                                (faceVertex: Cube.FaceVertex, faceVertexId: number) => `
                        ao = 0u;
                        {
                            let a: bool = doesNeighbourExist(cacheIndex, vec3i(${faceVertex.shadowingNeighbourVoxels[0].x},${faceVertex.shadowingNeighbourVoxels[0].y
                                    },${faceVertex.shadowingNeighbourVoxels[0].z}));
                            let b: bool = doesNeighbourExist(cacheIndex, vec3i(${faceVertex.shadowingNeighbourVoxels[1].x},${faceVertex.shadowingNeighbourVoxels[1].y
                                    },${faceVertex.shadowingNeighbourVoxels[1].z}));
                            let c: bool = doesNeighbourExist(cacheIndex, vec3i(${faceVertex.shadowingNeighbourVoxels[2].x},${faceVertex.shadowingNeighbourVoxels[2].y
                                    },${faceVertex.shadowingNeighbourVoxels[2].z}));
                            if (a && b) {
                                ao = 3u;
                              } else {
                                ao = u32(a) + u32(b) + u32(c);
                              }
                        }
                        edgeRoundnessX = ${faceVertex.edgeNeighbourVoxels.x
                                        .map(neighbour => `!doesNeighbourExist(cacheIndex, vec3i(${neighbour.x},${neighbour.y},${neighbour.z}))`)
                                        .join(' && ')};
                        edgeRoundnessY = ${faceVertex.edgeNeighbourVoxels.y
                                        .map(neighbour => `!doesNeighbourExist(cacheIndex, vec3i(${neighbour.x},${neighbour.y},${neighbour.z}))`)
                                        .join(' && ')};
                        let vertex${faceVertexId}Position = vec3u(${faceVertex.vertex.x}u, ${faceVertex.vertex.y}u, ${faceVertex.vertex.z}u);
                        let vertex${faceVertexId}Data = encodeVertexData1(encodedVoxelPosition, vertex${faceVertexId}Position, ao, u32(edgeRoundnessX), u32(edgeRoundnessY));`
                            )
                            .join('')}
                        ${Cube.faceIndices
                            .map(
                                (faceVertexId: number, index: number) => `
                        verticesBuffer.verticesData[2u * (firstVertexIndex + ${index}u) + 0u] = vertex${faceVertexId}Data;
                        verticesBuffer.verticesData[2u * (firstVertexIndex + ${index}u) + 1u] = encodeVoxelData2(voxelMaterialId, faceNoiseId, ${face.normal.id}u, ${face.uvRight.id}u);`
                            )
                            .join('')}
                    }`
                )
                .join('\n')}
                }
            }
        }
    `;
        this.computePipeline = this.device.createComputePipeline({
            compute: {
                module: this.device!.createShaderModule({
                    code,
                }),
                entryPoint: 'main',
            },
            layout: 'auto',
        });

        this.localCacheBuffer = this.device.createBuffer({
            size:
                Uint32Array.BYTES_PER_ELEMENT * 3 +
                Uint16Array.BYTES_PER_ELEMENT * (localCacheSize.x * localCacheSize.y * localCacheSize.z),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: false,
        });

        const maxFacesPerVoxel = 6;
        const maxVoxelsCount = (localCacheSize.x - 2) * (localCacheSize.y - 2) * (localCacheSize.z - 2);
        const verticesPerVoxel = 6;
        const bufferSize = Uint32Array.BYTES_PER_ELEMENT * (1 + Math.ceil(maxVoxelsCount / 2) * maxFacesPerVoxel * verticesPerVoxel);

        this.buffer = {
            storageBuffer: this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                mappedAtCreation: false,
            }),
            readableBuffer: this.device.createBuffer({
                size: bufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                mappedAtCreation: false,
            }),
        };

        const totalBuffersSize = this.buffer.storageBuffer.size + this.buffer.readableBuffer.size;
        logger.info(`Allocated ${(totalBuffersSize / 1024 / 1024).toFixed(1)} MB of webgpu buffers.`);

        this.computePipelineBindgroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [{
                binding: 0,
                resource: { buffer: this.localCacheBuffer },
            }, {
                binding: 1,
                resource: { buffer: this.buffer.storageBuffer },
            }]
        });
    }

    public async computeBuffer(localMapCache: LocalMapCache): Promise<ComputationOutputs> {
        this.device.queue.writeBuffer(
            this.localCacheBuffer,
            0,
            new Int32Array([localMapCache.size.x, localMapCache.size.y, localMapCache.size.z])
        );
        this.device.queue.writeBuffer(this.localCacheBuffer, Int32Array.BYTES_PER_ELEMENT * 3, localMapCache.data);

        const patchSize = localMapCache.size.clone().subScalar(2);
        const totalPatchCells = patchSize.x * patchSize.y * patchSize.z;

        const commandEncoder = this.device.createCommandEncoder();
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computePipelineBindgroup);
        computePass.dispatchWorkgroups(Math.ceil(totalPatchCells / this.workgroupSize));
        computePass.end();

        commandEncoder.copyBufferToBuffer(this.buffer.storageBuffer, 0, this.buffer.readableBuffer, 0, this.buffer.readableBuffer.size);

        this.device.queue.submit([commandEncoder.finish()]);

        await Promise.all([
            this.device.queue.onSubmittedWorkDone(),
            this.buffer.readableBuffer.mapAsync(GPUMapMode.READ),
        ]);

        const cpuBuffer = new Uint32Array(this.buffer.readableBuffer.getMappedRange());

        const verticesCount = cpuBuffer[0];
        if (typeof verticesCount === 'undefined') {
            throw new Error();
        }

        const uint32PerVertex = 2;
        const verticesDataBuffer = cpuBuffer.subarray(1, 1 + uint32PerVertex * verticesCount);
        const finalBuffer = new Uint32Array(verticesDataBuffer.length);
        finalBuffer.set(verticesDataBuffer);
        this.buffer.readableBuffer.unmap();

        return finalBuffer;
    }

    public dispose(): void {
        this.localCacheBuffer.destroy();
        this.buffer.storageBuffer.destroy();
        this.buffer.readableBuffer.destroy();

        logger.debug('Destroying WebGPU device...');
        this.device.destroy();
    }
}

export { PatchComputerGpu, type ComputationOutputs };
