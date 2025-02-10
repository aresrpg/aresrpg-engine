import { applyReplacements, vec3ToString } from '../../helpers/string';
import * as THREE from '../../libs/three-usage';

type UniformType = 'sampler2D' | 'float' | 'vec2' | 'vec3' | 'vec4';
type UniformDefinition<T> = THREE.IUniform<T> & { readonly type: UniformType };

type AttributeType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat2';
type AttributeDefinition = { readonly type: AttributeType };

type VaryingType = 'float' | 'vec2' | 'vec3' | 'vec4';
type VaryingDefinition = { readonly type: VaryingType };

type Parameters = {
    readonly origin?: THREE.Vector2Like | undefined;
    readonly lockAxis?: THREE.Vector3Like | undefined;
    readonly material: 'Basic' | 'Phong';
    readonly blending?: THREE.Blending | undefined;
    readonly depthWrite?: boolean | undefined;
    readonly transparent?: boolean | undefined;
    readonly uniforms: Record<string, UniformDefinition<unknown>>;
    readonly attributes: Record<string, AttributeDefinition>;
    readonly varyings: Record<string, VaryingDefinition>;
    readonly vertex: {
        readonly getBillboardAndSetVaryingsCode: string; // must set a vec3 "modelPosition", and a mat2 "localTransform"
    };
    readonly fragment: {
        readonly getColorCode: string;
    };
};

let id = 0;

function createBillboardMaterial(params: Parameters): THREE.Material {
    let material: THREE.Material;
    if (params.material === 'Phong') {
        material = new THREE.MeshPhongMaterial();
        material.name = 'billboard-material-phong';
    } else if (params.material === 'Basic') {
        material = new THREE.MeshBasicMaterial();
        material.name = 'billboard-material-basic';
    } else {
        throw new Error(`Unsupported material "${params.material}".`);
    }

    material.blending = params.blending ?? THREE.NormalBlending;
    material.depthWrite = params.depthWrite ?? true;
    material.transparent = params.transparent ?? false;

    material.customProgramCacheKey = () => `billboard_material_${id++}`;
    material.onBeforeCompile = parameters => {
        parameters.uniforms = {
            ...parameters.uniforms,
            ...params.uniforms,
        };

        const spriteOrigin = params.origin ?? { x: 0, y: 0 };

        parameters.vertexShader = applyReplacements(parameters.vertexShader, {
            'void main() {': `
${Object.entries(params.uniforms)
    .map(([key, uniform]) => `uniform ${uniform.type} ${key};`)
    .join('\n')}

${Object.entries(params.attributes)
    .map(([key, attribute]) => `attribute ${attribute.type} ${key};`)
    .join('\n')}
varying vec2 vUv;

${Object.entries(params.varyings)
    .map(([key, varying]) => `varying ${varying.type} v_${key};`)
    .join('\n')}

#include <packing>

void getBillboard(
${[
    'out vec3 modelPosition',
    'out mat2 localTransform',
    ...Object.entries(params.varyings).map(([key, varying]) => `out ${varying.type} ${key}`),
]
    .map(name => `\t${name}`)
    .join(',\n')}

) {
    ${params.vertex.getBillboardAndSetVaryingsCode}
}

void main() {
    vec3 modelPosition;
    mat2 localTransform;

    getBillboard(
${['modelPosition', 'localTransform', ...Object.keys(params.varyings).map(key => `v_${key}`)].map(name => `\t\t${name}`).join(',\n')}
    );

    vec3 up = ${
        params.lockAxis
            ? `vec3(${vec3ToString(new THREE.Vector3().copy(params.lockAxis).normalize(), ', ')})`
            : 'normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]))'
    };
    vec4 billboardOriginWorld = modelMatrix * vec4(modelPosition, 1);
    vec3 lookVector = normalize(cameraPosition - billboardOriginWorld.xyz / billboardOriginWorld.w);
    vec3 right = normalize(cross(lookVector, up));
`,
            '#include <begin_vertex>': `
    const vec2 origin2d = vec2(${spriteOrigin.x.toFixed(3)}, ${spriteOrigin.y.toFixed(3)});
    vec2 localPosition2d = localTransform * (position.xy - origin2d);

    vec3 transformed = modelPosition + localPosition2d.x * right + localPosition2d.y * up;

    vUv = uv;
`,
            '#include <beginnormal_vertex>': `
    vec3 objectNormal = lookVector;
`,
        });

        parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
            'void main() {': `
${Object.entries(params.uniforms)
    .map(([key, uniform]) => `uniform ${uniform.type} ${key};`)
    .join('\n')}

varying vec2 vUv;
${Object.entries(params.varyings)
    .map(([key, varying]) => `varying ${varying.type} v_${key};`)
    .join('\n')}

vec4 getColor(
    ${['const vec2 uv', ...Object.entries(params.varyings).map(([key, varying]) => `const ${varying.type} ${key}`)]
        .map(name => `\t${name}`)
        .join(',\n')}
) {
    ${params.fragment.getColorCode}
}

void main() {`,
            '#include <map_fragment>': `
    diffuseColor.rgb = getColor(
    ${['vUv', ...Object.keys(params.varyings).map(key => `v_${key}`)].map(name => `\t${name}`).join(',\n')}
).rgb;
`,
        });
    };
    return material;
}

function createBillboardInstancedBufferGeometry(): THREE.InstancedBufferGeometry {
    const bufferGeometry = new THREE.InstancedBufferGeometry();
    bufferGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0], 3)
    );
    bufferGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    bufferGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0], 2));
    bufferGeometry.name = 'billboard-instanced-buffergeometry';
    return bufferGeometry;
}

export {
    createBillboardInstancedBufferGeometry,
    createBillboardMaterial,
    type AttributeDefinition,
    type UniformDefinition,
    type VaryingDefinition,
};
