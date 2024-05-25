import * as THREE from '../../../../three-usage';
import { type IVoxelMap } from '../../../i-voxel-map';
import { EDisplayMode, type PatchMaterial, type PatchMaterialUniforms, type PatchMaterials } from '../../material';
import * as Cube from '../cube';
import { EPatchComputingMode, type GeometryAndMaterial, PatchFactoryBase } from '../patch-factory-base';

import { type PatchSize, VertexData1Encoder } from './vertex-data1-encoder';
import { VertexData2Encoder } from './vertex-data2-encoder';

type PatchMaterialTemp = THREE.Material & {
    readonly userData: {
        uniforms: PatchMaterialUniforms;
    };
};

abstract class PatchFactory extends PatchFactoryBase {
    private static readonly data1AttributeName = 'aData';
    private static readonly data2AttributeName = 'aData2';

    protected readonly vertexData1Encoder: VertexData1Encoder;
    protected static readonly vertexData2Encoder = new VertexData2Encoder();

    public readonly maxPatchSize: THREE.Vector3;

    private readonly materialsTemplates: PatchMaterials;

    private buildThreeJsPatchMaterial(): PatchMaterial {
        function applyReplacements(source: string, replacements: Record<string, string>): string {
            let result = source;

            for (const [source, replacement] of Object.entries(replacements)) {
                result = result.replace(source, replacement);
            }

            return result;
        }

        const phongMaterial = new THREE.MeshPhongMaterial();
        phongMaterial.shininess = 0;
        const material = phongMaterial as unknown as PatchMaterialTemp;
        material.userData.uniforms = this.uniformsTemplate;
        material.customProgramCacheKey = () => `patch-factory-merged`;
        material.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...material.userData.uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
in uint ${PatchFactory.data1AttributeName};
in uint ${PatchFactory.data2AttributeName};

out vec2 vUv;
out vec2 vEdgeRoundness;
flat out uint vData2;
out float vAo;

void main() {`,
                '#include <begin_vertex>': `
    const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
    uint vertexId = vertexIds[gl_VertexID % 6];

    uvec3 modelVoxelPosition = uvec3(
        ${this.vertexData1Encoder.voxelX.glslDecode(PatchFactory.data1AttributeName)},
        ${this.vertexData1Encoder.voxelY.glslDecode(PatchFactory.data1AttributeName)},
        ${this.vertexData1Encoder.voxelZ.glslDecode(PatchFactory.data1AttributeName)}
    );

    uvec3 localVertexPosition = uvec3(
        ${this.vertexData1Encoder.localX.glslDecode(PatchFactory.data1AttributeName)},
        ${this.vertexData1Encoder.localY.glslDecode(PatchFactory.data1AttributeName)},
        ${this.vertexData1Encoder.localZ.glslDecode(PatchFactory.data1AttributeName)}
    );
    vec3 modelPosition = vec3(modelVoxelPosition + localVertexPosition);
    vec3 transformed = modelPosition;
    
    const vec2 uvs[] = vec2[](
            vec2(0,0),
            vec2(0,1),
            vec2(1,0),
            vec2(1,1)
        );
    vUv = uvs[vertexId];

    const vec2 edgeRoundness[] = vec2[](
        vec2(0,0),
        vec2(1,0),
        vec2(0,1),
        vec2(1,1)
    );
    uint edgeRoundnessId = ${this.vertexData1Encoder.edgeRoundness.glslDecode(PatchFactory.data1AttributeName)};
    vEdgeRoundness = edgeRoundness[edgeRoundnessId];

    vAo = float(${this.vertexData1Encoder.ao.glslDecode(
        PatchFactory.data1AttributeName
    )}) / ${this.vertexData1Encoder.ao.maxValue.toFixed(1)};

    vData2 = ${PatchFactory.data2AttributeName};
        `,
                '#include <beginnormal_vertex>': `
    const vec3 faceNormalById[] = vec3[](
        ${Cube.facesById.map(face => `vec3(${face.normal.vec.x}, ${face.normal.vec.y}, ${face.normal.vec.z})`).join(',\n')}
    );
    uint faceId = ${this.vertexData1Encoder.faceId.glslDecode(PatchFactory.data1AttributeName)};
    vec3 objectNormal = faceNormalById[faceId];
`,
            });

            parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
                'void main() {': `
uniform sampler2D uTexture;
uniform sampler2D uNoiseTexture;
uniform float uNoiseStrength;
uniform float uAoStrength;
uniform float uAoSpread;
uniform float uSmoothEdgeRadius;
uniform uint uSmoothEdgeMethod;
uniform uint uDisplayMode;

uniform mat3 normalMatrix; // from three.js

in vec2 vUv;
in vec2 vEdgeRoundness;
flat in uint vData2;
in float vAo;

vec3 computeModelNormal() {
    const vec3 modelNormalsById[] = vec3[](
        ${Cube.normalsById.map(value => `vec3(${value.x}, ${value.y}, ${value.z})`).join(',\n')}
    );

    vec3 modelFaceNormal = modelNormalsById[${PatchFactory.vertexData2Encoder.normalId.glslDecode('vData2')}];
    if (uSmoothEdgeRadius <= 0.0) {
        return modelFaceNormal;
    }

    vec3 localNormal;

    vec2 edgeRoundness = step(${PatchFactoryBase.maxSmoothEdgeRadius.toFixed(2)}, vEdgeRoundness);
    if (uSmoothEdgeMethod == 0u) {
        vec2 margin = mix(vec2(0), vec2(uSmoothEdgeRadius), edgeRoundness);
        vec3 roundnessCenter = vec3(clamp(vUv, margin, 1.0 - margin), -uSmoothEdgeRadius);
        localNormal = normalize(vec3(vUv, 0) - roundnessCenter);
    } else if (uSmoothEdgeMethod == 1u) {
        vec2 symetricUv = clamp(vUv - 0.5, -0.5,  0.5);
        vec2 distanceFromMargin = edgeRoundness * sign(symetricUv) * max(abs(symetricUv) - (0.5 - uSmoothEdgeRadius), 0.0) / uSmoothEdgeRadius;
        localNormal = normalize(vec3(distanceFromMargin, 1));
    } else if (uSmoothEdgeMethod == 2u) {
        vec2 symetricUv = clamp(vUv - 0.5, -0.5,  0.5);
        vec2 distanceFromMargin = edgeRoundness * sign(symetricUv) * max(abs(symetricUv) - (0.5 - uSmoothEdgeRadius), 0.0) / uSmoothEdgeRadius;
        distanceFromMargin = sign(distanceFromMargin) * distanceFromMargin * distanceFromMargin;
        localNormal = normalize(vec3(distanceFromMargin, 1));
    }

    vec3 uvRight = modelNormalsById[${PatchFactory.vertexData2Encoder.uvRightId.glslDecode('vData2')}];
    vec3 uvUp = cross(modelFaceNormal, uvRight);

    vec3 modelNormal = localNormal.x * uvRight + localNormal.y * uvUp + localNormal.z * modelFaceNormal;
    return modelNormal;
}

float computeNoise() {
    int noiseId = int(${PatchFactory.vertexData2Encoder.faceNoiseId.glslDecode('vData2')});
    ivec2 texelCoords = clamp(ivec2(vUv * ${this.noiseResolution.toFixed(1)}), ivec2(0), ivec2(${this.noiseResolution - 1}));
    texelCoords.x += noiseId * ${this.noiseResolution};
    float noise = texelFetch(uNoiseTexture, texelCoords, 0).r - 0.5;
    return uNoiseStrength * noise;
}

void main() {
    vec3 modelFaceNormal = computeModelNormal();
`,
                '#include <normal_fragment_begin>': `
    vec3 normal = normalMatrix * modelFaceNormal;`,
                '#include <map_fragment>': `
    diffuseColor.rgb = vec3(0.75);
    if (uDisplayMode == ${EDisplayMode.TEXTURES}u) {
        uint voxelMaterialId = ${PatchFactory.vertexData2Encoder.voxelMaterialId.glslDecode('vData2')};
        ivec2 texelCoords = ivec2(voxelMaterialId, 0);
        diffuseColor.rgb = texelFetch(uTexture, texelCoords, 0).rgb;
    } else if (uDisplayMode == ${EDisplayMode.NORMALS}u) {
        diffuseColor.rgb = 0.5 + 0.5 * modelFaceNormal;
    }
    diffuseColor.rgb += computeNoise();
    
    float ao = (1.0 - uAoStrength) + uAoStrength * (smoothstep(0.0, uAoSpread, 1.0 - vAo));
    diffuseColor.rgb *= ao;
    `,
            });
        };
        return material;
    }

    private buildShadowMaterial(): THREE.Material {
        // Custom shadow material using RGBA depth packing.
        // A custom material for shadows is needed here, because the geometry is created inside the vertex shader,
        // so the builtin threejs shadow material will not work.
        // Written like:
        // https://github.com/mrdoob/three.js/blob/2ff77e4b335e31c108aac839a07401664998c730/src/renderers/shaders/ShaderLib/depth.glsl.js#L47
        return new THREE.ShaderMaterial({
            glslVersion: '300 es',
            vertexShader: `
        in uint ${PatchFactory.data1AttributeName};

        // This is used for computing an equivalent of gl_FragCoord.z that is as high precision as possible.
        // Some platforms compute gl_FragCoord at a lower precision which makes the manually computed value better for
        // depth-based postprocessing effects. Reproduced on iPad with A10 processor / iPadOS 13.3.1.
        varying vec2 vHighPrecisionZW;

        void main(void) {
            const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
            uint vertexId = vertexIds[gl_VertexID % 6];

            uvec3 modelVoxelPosition = uvec3(
                ${this.vertexData1Encoder.voxelX.glslDecode(PatchFactory.data1AttributeName)},
                ${this.vertexData1Encoder.voxelY.glslDecode(PatchFactory.data1AttributeName)},
                ${this.vertexData1Encoder.voxelZ.glslDecode(PatchFactory.data1AttributeName)}
            );

            uvec3 localVertexPosition = uvec3(
                ${this.vertexData1Encoder.localX.glslDecode(PatchFactory.data1AttributeName)},
                ${this.vertexData1Encoder.localY.glslDecode(PatchFactory.data1AttributeName)},
                ${this.vertexData1Encoder.localZ.glslDecode(PatchFactory.data1AttributeName)}
            );
            vec3 modelPosition = vec3(modelVoxelPosition + localVertexPosition);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(modelPosition, 1.0);

            vHighPrecisionZW = gl_Position.zw;
        }`,
            fragmentShader: `precision highp float;

        #include <packing>

        in vec2 vHighPrecisionZW;

        out vec4 fragColor;

        void main(void) {
            // Higher precision equivalent of gl_FragCoord.z. This assumes depthRange has been left to its default values.
            float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

            // RGBA depth packing 
            fragColor = packDepthToRGBA( fragCoordZ );
        }`,
        });
    }

    private buildPatchMaterial(): PatchMaterials {
        const material = this.buildThreeJsPatchMaterial();
        const shadowMaterial = this.buildShadowMaterial();
        return { material, shadowMaterial };
    }

    protected constructor(map: IVoxelMap, computingMode: EPatchComputingMode, patchSize: PatchSize) {
        super(map, PatchFactory.vertexData2Encoder.voxelMaterialId, computingMode);

        this.vertexData1Encoder = new VertexData1Encoder(patchSize);
        this.maxPatchSize = new THREE.Vector3(
            this.vertexData1Encoder.voxelX.maxValue + 1,
            this.vertexData1Encoder.voxelY.maxValue + 1,
            this.vertexData1Encoder.voxelZ.maxValue + 1
        );

        this.materialsTemplates = this.buildPatchMaterial();
    }

    protected async disposeInternal(): Promise<void> {
        this.materialsTemplates.material.dispose();
        this.materialsTemplates.shadowMaterial.dispose();
    }

    protected assembleGeometryAndMaterials(buffer: Uint32Array): GeometryAndMaterial[] {
        const verticesCount = buffer.length / 2;
        if (verticesCount === 0) {
            return [];
        }

        const geometry = new THREE.BufferGeometry();
        const interleavedBuffer = new THREE.InterleavedBuffer(buffer, 2);

        const data1Attribute = new THREE.InterleavedBufferAttribute(interleavedBuffer, 1, 0);
        const data2Attribute = new THREE.InterleavedBufferAttribute(interleavedBuffer, 1, 1);

        // const faceTypeVerticesDataBuffer = new THREE.Uint32BufferAttribute(buffer, 1, false);
        // faceTypeVerticesDataBuffer.onUpload(() => {
        //     (faceTypeVerticesDataBuffer.array as THREE.TypedArray | null) = null;
        // });
        geometry.setAttribute(PatchFactory.data1AttributeName, data1Attribute);
        geometry.setAttribute(PatchFactory.data2AttributeName, data2Attribute);
        geometry.setDrawRange(0, verticesCount);

        const trianglesCount = verticesCount / 3;
        const gpuMemoryBytes = interleavedBuffer.array.byteLength;
        return [{ id: 'merged', materials: this.materialsTemplates, geometry, trianglesCount, gpuMemoryBytes }];
    }
}

export { PatchFactory, type PatchMaterials };
