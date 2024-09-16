import * as THREE from '../../../../libs/three-usage';

import { type GridCoord, BoardOverlay } from './board-overlay';

type Parameters = {
    readonly size: GridCoord;
    readonly color?: THREE.Color;
    readonly margin?: number;
    readonly borderThickness?: number;
    readonly innerCornerRadius?: number;
};

class BoardOverlayBlob extends BoardOverlay {
    private readonly texture: THREE.DataTexture;
    private readonly textureData: Uint32Array;

    private readonly colorUniforms: THREE.IUniform<THREE.Vector4>[];

    public constructor(params: Parameters) {
        const marginUniform = { value: params.margin ?? 0.05 };
        const borderThicknessUniform = { value: params.borderThickness ?? 0.05 };
        const innerCornerRadiusUniform = { value: params.innerCornerRadius ?? 0.2 };

        const colorUniformsObject: Record<string, THREE.IUniform<THREE.Vector4>> = {};
        for (let i = 0; i < 32; i++) {
            const color = params.color
                ? new THREE.Vector4(params.color.r, params.color.g, params.color.b, 0.7)
                : new THREE.Vector4(1, 1, 1, 0.7);
            colorUniformsObject[`uColor_${i}`] = { value: color };
        }

        const textureData = new Uint32Array(params.size.x * params.size.z);
        const texture = new THREE.DataTexture(textureData, params.size.x, params.size.z, THREE.RedIntegerFormat, THREE.UnsignedIntType);
        texture.internalFormat = 'R32UI';
        texture.needsUpdate = true;

        super({
            name: 'blob',
            size: params.size,
            uniforms: {
                uMargin: marginUniform,
                uBorderThickness: borderThicknessUniform,
                uInnerCornerRadius: innerCornerRadiusUniform,
                uDataTexture: { value: texture },
                ...colorUniformsObject,
            },
            fragmentShader: `
uniform highp usampler2D uDataTexture;
uniform float uMargin;
uniform float uBorderThickness;
uniform float uInnerCornerRadius;
${Object.keys(colorUniformsObject)
    .map(name => `uniform vec4 ${name};`)
    .join('\n')}

in vec2 vGridCell;
out vec4 fragColor;

bool isCellOn(const uint layer, const ivec2 cellId) {
    uint data = texelFetch(uDataTexture, cellId, 0).r;
    uint layerData = data & (1u << layer);
    return layerData > 0u;
}

void computeLayer(const uint layer, const ivec2 gridCellId, const vec2 uv, out float isInner, out float isEdge, out float isIn) {
    isInner = 0.0;
    isEdge = 0.0;
    isIn = 0.0;

    bool cell_0_0 = isCellOn(layer, gridCellId);
    if (!cell_0_0) {
        return;
    }
    
    vec2 dUv = uv - 0.5;
    ivec2 right;
    if (dUv.y >= 0.0) {
        if (dUv.x >= 0.0) {
            right = ivec2(1,0);
        } else {
            right = ivec2(0,1);
        }
    } else {
        if (dUv.x >= 0.0) {
            right = ivec2(0,-1);
        } else {
            right = ivec2(-1,0);
        }
    }
    ivec2 up = ivec2(-right.y, right.x);

    bool cell_1 = isCellOn(layer, gridCellId + up);
    bool cell_2 = isCellOn(layer, gridCellId + up + right);
    bool cell_3 = isCellOn(layer, gridCellId + right);

    dUv = vec2(
        dot(vec2(right), dUv),
        dot(vec2(up), dUv)
    );

    float border = uBorderThickness;
    float r2 = 0.5 - uMargin;
    float r1 = r2 - border - uInnerCornerRadius;

    isIn = 1.0;
    if (cell_1) {
        if (cell_3) {
            if (cell_2) {
                isInner = 1.0;
            } else {
                vec2 dCenter = max(vec2(0), 0.5 - dUv);
                float dist = length(dCenter);

                isEdge = step(dist, 0.5 - r2 + border);
                isInner = 1.0 - isEdge;
                isIn = step(0.5 - r2, dist);
            }
        } else {
            isEdge = step(r2 - border, dUv.x);
            isInner = 1.0 - isEdge;
            isIn = step(dUv.x, r2);
        }
    } else {
        if (cell_3) {
            isEdge = step(r2 - border, dUv.y);
            isInner = 1.0 - isEdge;
            isIn = step(dUv.y, r2);
        } else {
            vec2 dCenter = max(vec2(0), dUv - r1);
            float dist = length(dCenter);

            isEdge = step(r2 - border - r1 + 0.00001, dist);
            isInner = 1.0 - isEdge;
            isIn = step(dist, r2 - r1);
        }
    }
}

void main(void) {
    ivec2 gridCellId = ivec2(floor(vGridCell));
    vec2 uv = fract(vGridCell);

    vec4 cumulatedInnerColor = vec4(0, 0, 0, 0);
    vec4 cumulatedEdgeColor = vec4(0, 0, 0, 0);
    float visibleInnerCount = 0.0;
    float visibleEdgesCount = 0.0;

    ${Object.keys(colorUniformsObject)
        .map(
            (name: string, index: number) => `
    {
        float isInner;
        float isEdge;
        float isIn;
        computeLayer(${index}u, gridCellId, uv, isInner, isEdge, isIn);
        if (isIn > 0.0) {
            if (isEdge > 0.0) {
                visibleEdgesCount++;
                cumulatedEdgeColor += ${name};
            } else if (isInner > 0.0) {
                visibleInnerCount++;
                cumulatedInnerColor += ${name};
            }
        }
    }`
        )
        .join('\n')}

    if (visibleEdgesCount > 0.0) {
        fragColor = vec4(cumulatedEdgeColor.rgb / visibleEdgesCount, 1.0);
    } else if (visibleInnerCount > 0.0) {
       fragColor = cumulatedInnerColor / visibleInnerCount;
    } else {
        discard;
    }
}`,
        });

        this.textureData = textureData;
        this.texture = texture;

        this.colorUniforms = Object.values(colorUniformsObject);
    }

    public clearAll(): void {
        this.textureData.fill(0);
        this.texture.needsUpdate = true;
    }

    public clear(blobIndex: number): void {
        for (let i = 0; i < this.textureData.length; i++) {
            let data = this.textureData[i]!;
            data &= ~(1 << blobIndex);
            this.textureData[i] = data;
        }
        this.texture.needsUpdate = true;
    }

    public override dispose(): void {
        this.texture.dispose();
        super.dispose();
    }

    public setColor(blobIndex: number, value: THREE.Color) {
        const uniform = this.colorUniforms[blobIndex];
        if (typeof uniform === 'undefined') {
            throw new Error(`Invalid blob index "${blobIndex}".`);
        }
        uniform.value.x = value.r;
        uniform.value.y = value.g;
        uniform.value.z = value.b;
    }

    public setAlpha(blobIndex: number, value: number) {
        const uniform = this.colorUniforms[blobIndex];
        if (typeof uniform === 'undefined') {
            throw new Error(`Invalid blob index "${blobIndex}".`);
        }
        uniform.value.w = value;
    }

    public enableCell(blobIndex: number, cellId: GridCoord): void {
        let data = this.getTexel(cellId);
        data |= 1 << blobIndex;
        this.setTexel(cellId, data);
    }

    public disableCell(blobIndex: number, cellId: GridCoord): void {
        let data = this.getTexel(cellId);
        data &= ~(1 << blobIndex);
        this.setTexel(cellId, data);
    }

    private setTexel(position: GridCoord, texelData: number): void {
        const index = this.buildTexelIndex(position);
        this.textureData[index] = texelData;
        this.texture.needsUpdate = true;
    }

    private getTexel(position: GridCoord): number {
        const index = this.buildTexelIndex(position);
        const data = this.textureData[index];
        if (typeof data === 'undefined') {
            throw new Error();
        }
        return data;
    }

    private buildTexelIndex(position: GridCoord): number {
        if (position.x < 0 || position.z < 0 || position.x >= this.gridSize.x || position.z >= this.gridSize.z) {
            throw new Error(`Out of bounds position "${position.x}x${position.z}" (size is "${this.gridSize.x}x${this.gridSize.z}")`);
        }

        return position.x + position.z * this.gridSize.x;
    }
}

export { BoardOverlayBlob };
