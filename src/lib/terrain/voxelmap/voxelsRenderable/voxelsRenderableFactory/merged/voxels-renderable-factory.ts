import * as THREE from '../../../../../libs/three-usage';
import { vec3ToString } from '../../../../../helpers/string';
import { type IVoxelMaterial, type VoxelsChunkSize } from '../../../i-voxelmap';
import { EVoxelsDisplayMode, type VoxelsMaterial, type VoxelsMaterialUniforms, type VoxelsMaterials } from '../../voxels-material';
import * as Cube from '../cube';
import { VoxelsRenderableFactoryBase, type CheckerboardType, type GeometryAndMaterial } from '../voxels-renderable-factory-base';

import { VertexData1Encoder } from './vertex-data1-encoder';
import { VertexData2Encoder } from './vertex-data2-encoder';

type VoxelsMaterialTemp = THREE.Material & {
    readonly userData: {
        uniforms: VoxelsMaterialUniforms;
    };
};

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly maxVoxelsChunkSize: VoxelsChunkSize;
    readonly noiseResolution?: number | undefined;
    readonly checkerboardType?: undefined | CheckerboardType;
};

abstract class VoxelsRenderableFactory extends VoxelsRenderableFactoryBase {
    private static instancesCount: number = 0;
    private readonly instanceId: number = 0;

    private static readonly data1AttributeName = 'aData';
    private static readonly data2AttributeName = 'aData2';

    protected readonly vertexData1Encoder: VertexData1Encoder;
    protected static readonly vertexData2Encoder = new VertexData2Encoder();

    public readonly maxVoxelsChunkSize: THREE.Vector3;

    private readonly materialsTemplates: VoxelsMaterials;

    private buildThreeJsVoxelsMaterial(): VoxelsMaterial {
        function applyReplacements(source: string, replacements: Record<string, string>): string {
            let result = source;

            for (const [source, replacement] of Object.entries(replacements)) {
                result = result.replace(source, replacement);
            }

            return result;
        }

        const cstVoxelAo = 'VOXELS_AO';
        const cstVoxelNoise = 'VOXELS_NOISE';
        const cstVoxelRounded = 'VOXELS_ROUNDED';
        const cstVoxelGrid = 'VOXELS_GRID';

        const phongMaterial = new THREE.MeshPhongMaterial();
        phongMaterial.shininess = 0;
        const material = phongMaterial as unknown as VoxelsMaterialTemp;
        material.userData.uniforms = this.uniformsTemplate;
        material.customProgramCacheKey = () => `voxels-factory-merged_${this.instanceId}`;
        material.defines = material.defines || {};
        material.defines[cstVoxelAo] = 1;
        material.defines[cstVoxelNoise] = 1;
        material.defines[cstVoxelRounded] = 1;
        material.defines[cstVoxelGrid] = 1;
        material.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...material.userData.uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
in uint ${VoxelsRenderableFactory.data1AttributeName};
in uint ${VoxelsRenderableFactory.data2AttributeName};

#if defined(${cstVoxelRounded}) || defined(${cstVoxelNoise}) || defined(${cstVoxelGrid})
out vec2 vModelUv;
#endif // ${cstVoxelRounded} || ${cstVoxelNoise} || ${cstVoxelGrid}

#ifdef ${cstVoxelRounded}
out vec2 vEdgeRoundness;
#endif // ${cstVoxelRounded}

flat out uint vData2;

#ifdef ${cstVoxelAo}
out float vAo;
#endif // ${cstVoxelAo}

void main() {`,
                '#include <begin_vertex>': `
    vec3 modelPosition = vec3(uvec3(
        ${this.vertexData1Encoder.positionX.glslDecode(VoxelsRenderableFactory.data1AttributeName)},
        ${this.vertexData1Encoder.positionY.glslDecode(VoxelsRenderableFactory.data1AttributeName)},
        ${this.vertexData1Encoder.positionZ.glslDecode(VoxelsRenderableFactory.data1AttributeName)}
    ));
    vec3 transformed = modelPosition;
    
#if defined(${cstVoxelRounded}) || defined(${cstVoxelNoise}) || defined(${cstVoxelGrid})
    if (faceId == ${Cube.facesById.findIndex(face => face.type === 'left')}u) {
        vModelUv = modelPosition.zy;
    } else if (faceId == ${Cube.facesById.findIndex(face => face.type === 'right')}u) {
        vModelUv = vec2(-modelPosition.z, modelPosition.y);
    } else if (faceId == ${Cube.facesById.findIndex(face => face.type === 'front')}u) {
        vModelUv = modelPosition.xy;
    } else if (faceId == ${Cube.facesById.findIndex(face => face.type === 'back')}u) {
        vModelUv = vec2(-modelPosition.x, modelPosition.y);
    } else if (faceId == ${Cube.facesById.findIndex(face => face.type === 'up')}u) {
        vModelUv = vec2(modelPosition.x, -modelPosition.z);
    } else {
        vModelUv = modelPosition.xz;
    }
#endif // ${cstVoxelRounded} || ${cstVoxelNoise} || ${cstVoxelGrid}

#ifdef ${cstVoxelRounded}
    const vec2 edgeRoundness[] = vec2[](
        vec2(0,0),
        vec2(1,0),
        vec2(0,1),
        vec2(1,1)
    );
    uint edgeRoundnessId = ${this.vertexData1Encoder.edgeRoundness.glslDecode(VoxelsRenderableFactory.data1AttributeName)};
    vEdgeRoundness = edgeRoundness[edgeRoundnessId];
#endif // ${cstVoxelRounded}

#ifdef ${cstVoxelAo}
    vAo = float(${this.vertexData1Encoder.ao.glslDecode(
        VoxelsRenderableFactory.data1AttributeName
    )}) / ${this.vertexData1Encoder.ao.maxValue.toFixed(1)};
#endif // ${cstVoxelAo}

    vData2 = ${VoxelsRenderableFactory.data2AttributeName};
        `,
                '#include <beginnormal_vertex>': `
    const vec3 faceNormalById[] = vec3[](
        ${Cube.facesById.map(face => `vec3(${vec3ToString(face.normal.vec, ', ')})`).join(',\n')}
    );
    uint faceId = ${this.vertexData1Encoder.faceId.glslDecode(VoxelsRenderableFactory.data1AttributeName)};
    vec3 objectNormal = faceNormalById[faceId];
`,
            });

            parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
                'void main() {': `
uniform sampler2D uTexture;

#ifdef ${cstVoxelNoise}
uniform sampler2D uNoiseTexture;
uniform float uNoiseStrength;
uniform float uCheckerboardStrength;
#endif // ${cstVoxelNoise}

#ifdef ${cstVoxelAo}
uniform float uAoStrength;
uniform float uAoSpread;
#endif // ${cstVoxelAo}

#ifdef ${cstVoxelRounded}
uniform float uSmoothEdgeRadius;
uniform uint uSmoothEdgeMethod;
#endif // ${cstVoxelRounded}

#ifdef ${cstVoxelGrid}
uniform vec3 uGridColor;
uniform float uGridThickness;
#endif // ${cstVoxelGrid}

uniform uint uDisplayMode;

uniform mat3 normalMatrix; // from three.js

#if defined(${cstVoxelRounded}) || defined(${cstVoxelNoise}) || defined(${cstVoxelGrid})
in vec2 vModelUv;
#endif // ${cstVoxelRounded} || ${cstVoxelNoise} || ${cstVoxelGrid}

#ifdef ${cstVoxelRounded}
in vec2 vEdgeRoundness;
#endif // ${cstVoxelRounded}

flat in uint vData2;

#ifdef ${cstVoxelAo}
in float vAo;
#endif // ${cstVoxelAo}

vec3 computeModelNormal() {
    const vec3 modelNormalsById[] = vec3[](
        ${Cube.normalsById.map(value => `vec3(${vec3ToString(value, ', ')})`).join(',\n')}
    );

    vec3 modelNormal = modelNormalsById[${VoxelsRenderableFactory.vertexData2Encoder.normalId.glslDecode('vData2')}];
#ifdef ${cstVoxelRounded}
    if (uSmoothEdgeRadius > 0.0) {
        vec2 uv = fract(vModelUv);
        vec2 edgeRoundness = step(${VoxelsRenderableFactory.maxSmoothEdgeRadius.toFixed(2)}, vEdgeRoundness);
        vec2 margin = mix(vec2(0), vec2(uSmoothEdgeRadius), edgeRoundness);
        vec3 roundnessCenter = vec3(clamp(uv, margin, 1.0 - margin), -uSmoothEdgeRadius);
        vec3 localNormal = normalize(vec3(uv, 0) - roundnessCenter);

        vec3 uvRight = modelNormalsById[${VoxelsRenderableFactory.vertexData2Encoder.uvRightId.glslDecode('vData2')}];
        vec3 uvUp = cross(modelNormal, uvRight);

        modelNormal = localNormal.x * uvRight + localNormal.y * uvUp + localNormal.z * modelNormal;
    }
#endif // ${cstVoxelRounded}

    return modelNormal;
}

#ifdef ${cstVoxelNoise}
float computeNoise() {
    int checkerboardCellId = int(${VoxelsRenderableFactory.vertexData2Encoder.checkerboardCellId.glslDecode('vData2')});
    float noise, noiseStrength;
    if (checkerboardCellId == 0) {
        ivec2 texelCoords = ivec2(mod(vModelUv * ${this.noiseResolution.toFixed(1)}, vec2(${this.noiseTextureSize})));
        noise = texelFetch(uNoiseTexture, texelCoords, 0).r - 0.5;
        noiseStrength = uNoiseStrength;
    } else {
        noise = 2.0 * (float(checkerboardCellId) - 1.5);
        noiseStrength = uCheckerboardStrength;
    }
    return noiseStrength * noise;
}
#endif // ${cstVoxelNoise}

void main() {
    vec3 modelNormal = computeModelNormal();
`,
                '#include <normal_fragment_begin>': `
    vec3 normal = normalMatrix * modelNormal;`,
                '#include <map_fragment>': `
    vec3 materialColor = vec3(0.75);
    if (uDisplayMode == ${EVoxelsDisplayMode.TEXTURED}u) {
        uint voxelMaterialId = ${VoxelsRenderableFactory.vertexData2Encoder.voxelMaterialId.glslDecode('vData2')};
        ivec2 texelCoords = ivec2(voxelMaterialId % ${this.texture.image.width}u, voxelMaterialId / ${this.texture.image.width}u);
        materialColor = texelFetch(uTexture, texelCoords, 0).rgb;
    } else if (uDisplayMode == ${EVoxelsDisplayMode.NORMALS}u) {
        materialColor = 0.5 + 0.5 * modelNormal;
    }

    diffuseColor.rgb = materialColor;

#ifdef ${cstVoxelNoise}
    diffuseColor.rgb += computeNoise();
#endif // ${cstVoxelNoise}

#ifdef ${cstVoxelGrid}
    if (uGridThickness > 0.0) {
        vec2 uv = fract(vModelUv);
        vec2 fromCenter = abs(uv - 0.5);
        vec2 isEdge = step(vec2(0.5 - uGridThickness), fromCenter);
        diffuseColor.rgb = mix(
            diffuseColor.rgb,
            materialColor + uGridColor,
            max(isEdge.x, isEdge.y)
        );
    }
#endif // ${cstVoxelGrid}

#ifdef ${cstVoxelAo}
    float ao = (1.0 - uAoStrength) + uAoStrength * (smoothstep(0.0, uAoSpread, 1.0 - vAo));
    diffuseColor.rgb *= ao;
#endif // ${cstVoxelAo}
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
        in uint ${VoxelsRenderableFactory.data1AttributeName};

        // This is used for computing an equivalent of gl_FragCoord.z that is as high precision as possible.
        // Some platforms compute gl_FragCoord at a lower precision which makes the manually computed value better for
        // depth-based postprocessing effects. Reproduced on iPad with A10 processor / iPadOS 13.3.1.
        varying vec2 vHighPrecisionZW;

        void main(void) {
            const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
            uint vertexId = vertexIds[gl_VertexID % 6];

            vec3 modelPosition = vec3(uvec3(
                ${this.vertexData1Encoder.positionX.glslDecode(VoxelsRenderableFactory.data1AttributeName)},
                ${this.vertexData1Encoder.positionY.glslDecode(VoxelsRenderableFactory.data1AttributeName)},
                ${this.vertexData1Encoder.positionZ.glslDecode(VoxelsRenderableFactory.data1AttributeName)}
            ));
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

    private buildVoxelsMaterials(): VoxelsMaterials {
        const material = this.buildThreeJsVoxelsMaterial();
        const shadowMaterial = this.buildShadowMaterial();
        return { material, shadowMaterial };
    }

    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            voxelTypeEncoder: VoxelsRenderableFactory.vertexData2Encoder.voxelMaterialId,
            noiseResolution: params.noiseResolution,
            checkerboardType: params.checkerboardType,
        });

        this.vertexData1Encoder = new VertexData1Encoder(params.maxVoxelsChunkSize);
        this.maxVoxelsChunkSize = new THREE.Vector3(
            params.maxVoxelsChunkSize.xz,
            params.maxVoxelsChunkSize.y,
            params.maxVoxelsChunkSize.xz
        );

        this.materialsTemplates = this.buildVoxelsMaterials();

        this.instanceId = VoxelsRenderableFactory.instancesCount++;
    }

    public override dispose(): void {
        super.dispose();
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
        // (interleavedBuffer as any).onUpload(() => { (interleavedBuffer.array as any) = undefined; })
        geometry.setAttribute(VoxelsRenderableFactory.data1AttributeName, data1Attribute);
        geometry.setAttribute(VoxelsRenderableFactory.data2AttributeName, data2Attribute);
        geometry.setDrawRange(0, verticesCount);

        const trianglesCount = verticesCount / 3;
        const gpuMemoryBytes = interleavedBuffer.array.byteLength;
        return [{ id: 'merged', materials: this.materialsTemplates, geometry, trianglesCount, gpuMemoryBytes }];
    }
}

export { VoxelsRenderableFactory, type Parameters, type VoxelsMaterials };
