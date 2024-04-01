import * as THREE from '../../../../three-usage';
import { IVoxelMap } from '../../../i-voxel-map';
import { EDisplayMode, PatchMaterial, PatchMaterialUniforms, PatchMaterials } from '../../material';
import * as Cube from '../cube';
import { EPatchComputingMode, GeometryAndMaterial, PatchFactoryBase } from '../patch-factory-base';

import { VertexDataEncoder } from './vertex-data-encoder';

type PatchMaterialTemp = THREE.Material & {
    readonly userData: {
        uniforms: PatchMaterialUniforms;
    };
};

abstract class PatchFactory extends PatchFactoryBase {
    private static readonly dataAttributeName = 'aData';

    protected static readonly vertexDataEncoder = new VertexDataEncoder();

    public readonly maxPatchSize = new THREE.Vector3(
        PatchFactory.vertexDataEncoder.voxelX.maxValue + 1,
        PatchFactory.vertexDataEncoder.voxelY.maxValue + 1,
        PatchFactory.vertexDataEncoder.voxelZ.maxValue + 1
    );

    private readonly materialsTemplates: Record<Cube.FaceType, PatchMaterials> = {
        up: this.buildPatchMaterial('up'),
        down: this.buildPatchMaterial('down'),
        left: this.buildPatchMaterial('left'),
        right: this.buildPatchMaterial('right'),
        front: this.buildPatchMaterial('front'),
        back: this.buildPatchMaterial('back'),
    };

    // Custom material that cannot receive three.js shadows but is a bit more performant
    private buildCustomPatchMaterial(faceType: Cube.FaceType): PatchMaterial {
        const material = new THREE.ShaderMaterial({
            glslVersion: '300 es',
            uniforms: this.uniformsTemplate,
            vertexShader: `
        in uint ${PatchFactory.dataAttributeName};

        out vec2 vUv;
        out vec2 vEdgeRoundness;
        flat out int vMaterial;
        flat out int vNoise;
        out float vAo;

        void main(void) {
            const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
            uint vertexId = vertexIds[gl_VertexID % 6];

            uvec3 modelVoxelPosition = uvec3(
                ${PatchFactory.vertexDataEncoder.voxelX.glslDecode(PatchFactory.dataAttributeName)},
                ${PatchFactory.vertexDataEncoder.voxelY.glslDecode(PatchFactory.dataAttributeName)},
                ${PatchFactory.vertexDataEncoder.voxelZ.glslDecode(PatchFactory.dataAttributeName)}
            );

            const uvec3 localVertexPositions[] = uvec3[](
                ${Cube.faces[faceType].vertices
                    .map(vertex => `uvec3(${vertex.vertex.x}, ${vertex.vertex.y}, ${vertex.vertex.z})`)
                    .join(',\n')}
            );
            uvec3 localVertexPosition = localVertexPositions[vertexId];
            vec3 modelPosition = vec3(modelVoxelPosition + localVertexPosition);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(modelPosition, 1.0);

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
            uint edgeRoundnessId = ${PatchFactory.vertexDataEncoder.edgeRoundness.glslDecode(PatchFactory.dataAttributeName)};
            vEdgeRoundness = edgeRoundness[edgeRoundnessId];

            vAo = float(${PatchFactory.vertexDataEncoder.ao.glslDecode(
                PatchFactory.dataAttributeName
            )}) / ${PatchFactory.vertexDataEncoder.ao.maxValue.toFixed(1)};

            vMaterial = int(${PatchFactory.vertexDataEncoder.voxelMaterialId.glslDecode(PatchFactory.dataAttributeName)});
            vNoise = int(modelVoxelPosition.x + modelVoxelPosition.y * 3u + modelVoxelPosition.z * 2u) % ${this.noiseTypes};
        }`,
            fragmentShader: `precision mediump float;

        uniform sampler2D uTexture;
        uniform sampler2D uNoiseTexture;
        uniform float uNoiseStrength;
        uniform vec3 uLightColor;
        uniform float uAmbientIntensity;
        uniform vec3 uDiffuseDirection;
        uniform float uDiffuseIntensity;
        uniform float uAoStrength;
        uniform float uAoSpread;
        uniform float uSmoothEdgeRadius;
        uniform uint uSmoothEdgeMethod;
        uniform uint uDisplayMode;

        in vec2 vUv;
        in vec2 vEdgeRoundness;
        flat in int vMaterial;
        flat in int vNoise;
        in float vAo;

        out vec4 fragColor;

        vec3 computeModelNormal() {
            const vec3 worldFaceNormal = vec3(${Cube.faces[faceType].normal.x.toFixed(1)}, ${Cube.faces[faceType].normal.y.toFixed(
                1
            )}, ${Cube.faces[faceType].normal.z.toFixed(1)});
            if (uSmoothEdgeRadius <= 0.0) {
                return worldFaceNormal;
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

            const vec3 uvUp = vec3(${Cube.faces[faceType].uvUp.x.toFixed(1)}, ${Cube.faces[faceType].uvUp.y.toFixed(1)}, ${Cube.faces[
                faceType
            ].uvUp.z.toFixed(1)});
            const vec3 uvRight = vec3(${Cube.faces[faceType].uvRight.x.toFixed(1)}, ${Cube.faces[faceType].uvRight.y.toFixed(
                1
            )}, ${Cube.faces[faceType].uvRight.z.toFixed(1)});
            return localNormal.x * uvRight + localNormal.y * uvUp + localNormal.z * worldFaceNormal;
        }

        float computeNoise() {
            ivec2 texelCoords = clamp(ivec2(vUv * ${this.noiseResolution.toFixed(1)}), ivec2(0), ivec2(${this.noiseResolution - 1}));
            texelCoords.x += vNoise * ${this.noiseResolution};
            float noise = texelFetch(uNoiseTexture, texelCoords, 0).r - 0.5;
            return uNoiseStrength * noise;
        }

        void main(void) {
            vec3 modelFaceNormal = computeModelNormal();

            vec3 color = vec3(0.75);
            if (uDisplayMode == ${EDisplayMode.TEXTURES}u) {
                ivec2 texelCoords = ivec2(vMaterial, 0);
                color = texelFetch(uTexture, texelCoords, 0).rgb;
            } else if (uDisplayMode == ${EDisplayMode.NORMALS}u) {
                color = 0.5 + 0.5 * modelFaceNormal;
            }

            color += computeNoise();
            
            float diffuse = max(0.0, dot(modelFaceNormal, uDiffuseDirection));

            float lightIntensity = uAmbientIntensity + uDiffuseIntensity * diffuse;
            float ao = (1.0 - uAoStrength) + uAoStrength * (smoothstep(0.0, uAoSpread, 1.0 - vAo));
            lightIntensity *= ao;
            color *= lightIntensity * uLightColor;

            fragColor = vec4(color, 1);
        }`,
        }) as unknown as PatchMaterialTemp;
        material.userData.uniforms = this.uniformsTemplate;
        return material;
    }

    private buildThreeJsPatchMaterial(faceType: Cube.FaceType): PatchMaterial {
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
        material.customProgramCacheKey = () => `patch-factory-split_${faceType}`;
        material.onBeforeCompile = parameters => {
            parameters.uniforms = {
                ...parameters.uniforms,
                ...material.userData.uniforms,
            };

            parameters.vertexShader = applyReplacements(parameters.vertexShader, {
                'void main() {': `
in uint ${PatchFactory.dataAttributeName};

out vec2 vUv;
out vec2 vEdgeRoundness;
flat out int vMaterial;
flat out int vNoise;
out float vAo;

void main() {`,
                '#include <begin_vertex>': `
    const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
    uint vertexId = vertexIds[gl_VertexID % 6];

    uvec3 modelVoxelPosition = uvec3(
        ${PatchFactory.vertexDataEncoder.voxelX.glslDecode(PatchFactory.dataAttributeName)},
        ${PatchFactory.vertexDataEncoder.voxelY.glslDecode(PatchFactory.dataAttributeName)},
        ${PatchFactory.vertexDataEncoder.voxelZ.glslDecode(PatchFactory.dataAttributeName)}
    );

    const uvec3 localVertexPositions[] = uvec3[](
        ${Cube.faces[faceType].vertices.map(vertex => `uvec3(${vertex.vertex.x}, ${vertex.vertex.y}, ${vertex.vertex.z})`).join(',\n\t\t')}
    );
    uvec3 localVertexPosition = localVertexPositions[vertexId];
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
        uint edgeRoundnessId = ${PatchFactory.vertexDataEncoder.edgeRoundness.glslDecode(PatchFactory.dataAttributeName)};
        vEdgeRoundness = edgeRoundness[edgeRoundnessId];

        vAo = float(${PatchFactory.vertexDataEncoder.ao.glslDecode(
            PatchFactory.dataAttributeName
        )}) / ${PatchFactory.vertexDataEncoder.ao.maxValue.toFixed(1)};

        vMaterial = int(${PatchFactory.vertexDataEncoder.voxelMaterialId.glslDecode(PatchFactory.dataAttributeName)});
        vNoise = int(modelVoxelPosition.x + modelVoxelPosition.y * 3u + modelVoxelPosition.z * 2u) % ${this.noiseTypes};
        `,
                '#include <beginnormal_vertex>': `
    vec3 objectNormal = vec3(${Cube.faces[faceType].normal.x}, ${Cube.faces[faceType].normal.y}, ${Cube.faces[faceType].normal.z});
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
flat in int vMaterial;
flat in int vNoise;
in float vAo;

vec3 computeModelNormal() {
    const vec3 worldFaceNormal = vec3(${Cube.faces[faceType].normal.x.toFixed(1)}, ${Cube.faces[faceType].normal.y.toFixed(
        1
    )}, ${Cube.faces[faceType].normal.z.toFixed(1)});
    if (uSmoothEdgeRadius <= 0.0) {
        return worldFaceNormal;
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

    const vec3 uvUp = vec3(${Cube.faces[faceType].uvUp.x.toFixed(1)}, ${Cube.faces[faceType].uvUp.y.toFixed(1)}, ${Cube.faces[
        faceType
    ].uvUp.z.toFixed(1)});
    const vec3 uvRight = vec3(${Cube.faces[faceType].uvRight.x.toFixed(1)}, ${Cube.faces[faceType].uvRight.y.toFixed(1)}, ${Cube.faces[
        faceType
    ].uvRight.z.toFixed(1)});
    vec3 modelNormal = localNormal.x * uvRight + localNormal.y * uvUp + localNormal.z * worldFaceNormal;
    return normalMatrix * modelNormal;
}

float computeNoise() {
    ivec2 texelCoords = clamp(ivec2(vUv * ${this.noiseResolution.toFixed(1)}), ivec2(0), ivec2(${this.noiseResolution - 1}));
    texelCoords.x += vNoise * ${this.noiseResolution};
    float noise = texelFetch(uNoiseTexture, texelCoords, 0).r - 0.5;
    return uNoiseStrength * noise;
}

void main() {
    vec3 modelFaceNormal = computeModelNormal();
`,
                '#include <normal_fragment_begin>': `
    vec3 normal = modelFaceNormal;`,
                '#include <map_fragment>': `
    diffuseColor.rgb = vec3(0.75);
    if (uDisplayMode == ${EDisplayMode.TEXTURES}u) {
        ivec2 texelCoords = ivec2(vMaterial, 0);
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

    private buildShadowMaterial(faceType: Cube.FaceType): THREE.Material {
        // Custom shadow material using RGBA depth packing.
        // A custom material for shadows is needed here, because the geometry is created inside the vertex shader,
        // so the builtin threejs shadow material will not work.
        // Written like:
        // https://github.com/mrdoob/three.js/blob/2ff77e4b335e31c108aac839a07401664998c730/src/renderers/shaders/ShaderLib/depth.glsl.js#L47
        return new THREE.ShaderMaterial({
            glslVersion: '300 es',
            vertexShader: `
        in uint ${PatchFactory.dataAttributeName};

        // This is used for computing an equivalent of gl_FragCoord.z that is as high precision as possible.
        // Some platforms compute gl_FragCoord at a lower precision which makes the manually computed value better for
        // depth-based postprocessing effects. Reproduced on iPad with A10 processor / iPadOS 13.3.1.
        varying vec2 vHighPrecisionZW;

        void main(void) {
            const uint vertexIds[] = uint[](${Cube.faceIndices.map(indice => `${indice}u`).join(', ')});
            uint vertexId = vertexIds[gl_VertexID % 6];

            uvec3 modelVoxelPosition = uvec3(
                ${PatchFactory.vertexDataEncoder.voxelX.glslDecode(PatchFactory.dataAttributeName)},
                ${PatchFactory.vertexDataEncoder.voxelY.glslDecode(PatchFactory.dataAttributeName)},
                ${PatchFactory.vertexDataEncoder.voxelZ.glslDecode(PatchFactory.dataAttributeName)}
            );

            const uvec3 localVertexPositions[] = uvec3[](
                ${Cube.faces[faceType].vertices
                    .map(vertex => `uvec3(${vertex.vertex.x}, ${vertex.vertex.y}, ${vertex.vertex.z})`)
                    .join(',\n')}
            );
            uvec3 localVertexPosition = localVertexPositions[vertexId];
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

    private buildPatchMaterial(faceType: Cube.FaceType): PatchMaterials {
        let material: PatchMaterial;
        const usePhongShader = true;
        if (usePhongShader) {
            material = this.buildThreeJsPatchMaterial(faceType);
        } else {
            material = this.buildCustomPatchMaterial(faceType);
        }

        const shadowMaterial = this.buildShadowMaterial(faceType);
        return { material, shadowMaterial };
    }

    protected constructor(map: IVoxelMap, computingMode: EPatchComputingMode) {
        super(map, PatchFactory.vertexDataEncoder.voxelMaterialId, computingMode);
    }

    protected async disposeInternal(): Promise<void> {
        for (const material of Object.values(this.materialsTemplates)) {
            material.material.dispose();
            material.shadowMaterial.dispose();
        }
    }

    protected assembleGeometryAndMaterials(buffers: Record<Cube.FaceType, Uint32Array>): GeometryAndMaterial[] {
        const processedBuffers = [
            this.assembleGeometryAndMaterial('up', buffers),
            this.assembleGeometryAndMaterial('down', buffers),
            this.assembleGeometryAndMaterial('left', buffers),
            this.assembleGeometryAndMaterial('right', buffers),
            this.assembleGeometryAndMaterial('front', buffers),
            this.assembleGeometryAndMaterial('back', buffers),
        ];

        const result: GeometryAndMaterial[] = [];
        for (const processedBuffer of processedBuffers) {
            if (processedBuffer) {
                result.push(processedBuffer);
            }
        }
        return result;
    }

    private assembleGeometryAndMaterial(faceType: Cube.FaceType, buffers: Record<Cube.FaceType, Uint32Array>): GeometryAndMaterial | null {
        const buffer = buffers[faceType];
        const verticesCount = buffer.length;
        if (verticesCount === 0) {
            return null;
        }

        const materials = this.materialsTemplates[faceType];
        const geometry = new THREE.BufferGeometry();
        const faceTypeVerticesDataBuffer = new THREE.Uint32BufferAttribute(buffer, 1, false);
        faceTypeVerticesDataBuffer.onUpload(() => {
            (faceTypeVerticesDataBuffer.array as THREE.TypedArray | null) = null;
        });
        geometry.setAttribute(PatchFactory.dataAttributeName, faceTypeVerticesDataBuffer);
        geometry.setDrawRange(0, verticesCount);

        return { materials, geometry };
    }
}

export { PatchFactory, type PatchMaterials };
