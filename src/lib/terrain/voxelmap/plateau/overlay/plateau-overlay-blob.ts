import * as THREE from '../../../../three-usage';

import { type GridCoord, PlateauOverlay } from './plateau-overlay';

type Parameters = {
    readonly size: GridCoord;
    readonly color?: THREE.Color;
    readonly margin?: number;
    readonly borderThickness?: number;
    readonly innerCornerRadius?: number;
};

class PlateauOverlayBlob extends PlateauOverlay {
    private readonly texture: THREE.DataTexture;
    private readonly textureData: Uint32Array;

    private readonly colorUniform: THREE.IUniform<THREE.Vector4>;

    public constructor(params: Parameters) {
        const marginUniform = { value: params.margin ?? 0.05 };
        const borderThicknessUniform = { value: params.borderThickness ?? 0.05 };
        const innerCornerRadiusUniform = { value: params.innerCornerRadius ?? 0.2 };
        const colorUniform = { value: params.color ? new THREE.Vector4(params.color.r, params.color.g, params.color.b, 0.7) : new THREE.Vector4(1, 1, 1, 0.7) };

        const textureData = new Uint32Array(params.size.x * params.size.z);
        const texture = new THREE.DataTexture(textureData, params.size.x, params.size.z, THREE.RedIntegerFormat, THREE.UnsignedIntType);
        texture.internalFormat = "R32UI";
        texture.needsUpdate = true;

        super({
            name: 'blob',
            size: params.size,
            uniforms: {
                uMargin: marginUniform,
                uBorderThickness: borderThicknessUniform,
                uInnerCornerRadius: innerCornerRadiusUniform,
                uColor: colorUniform,
                uDataTexture: { value: texture },
            },
            fragmentShader: `
uniform highp usampler2D uDataTexture;
uniform float uMargin;
uniform float uBorderThickness;
uniform float uInnerCornerRadius;
uniform vec4 uColor;

in vec2 vGridCell;
out vec4 fragColor;

bool isCellOn(const ivec2 cellId) {
    uint data = texelFetch(uDataTexture, cellId, 0).r;
    return data > 0u;
}

void main(void) {
    ivec2 gridCellId = ivec2(floor(vGridCell));
    vec2 uv = fract(vGridCell);

    bool cell_0_0 = isCellOn(gridCellId);
    if (!cell_0_0) {
        discard;
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

    bool cell_1 = isCellOn(gridCellId + up);
    bool cell_2 = isCellOn(gridCellId + up + right);
    bool cell_3 = isCellOn(gridCellId + right);

    dUv = vec2(
        dot(vec2(right), dUv),
        dot(vec2(up), dUv)
    );

    float border = uBorderThickness;
    float r2 = 0.5 - uMargin;
    float r1 = r2 - border - uInnerCornerRadius;

    float alphaCenter = uColor.a;
    const float alphaBorder = 1.0;

    float alpha = 0.0;
    if (cell_1) {
        if (cell_3) {
            if (cell_2) {
                alpha = alphaCenter;
            } else {
                vec2 dCenter = max(vec2(0), 0.5 - dUv);
                float dist = length(dCenter);        
                alpha = mix(alphaCenter, alphaBorder, step(dist, 0.5 - r2 + border)) * step(0.5 - r2, dist);
            }
        } else {
            alpha = mix(alphaCenter, alphaBorder, step(r2 - border, dUv.x)) * step(dUv.x, r2);
        }
    } else {
        if (cell_3) {
            alpha = mix(alphaCenter, alphaBorder, step(r2 - border, dUv.y)) * step(dUv.y, r2);
        } else {
            vec2 dCenter = max(vec2(0), dUv - r1);
            float dist = length(dCenter);        
            alpha = mix(alphaCenter, alphaBorder, step(r2 - border - r1 + 0.00001, dist)) * step(dist, r2 - r1);
        }
    }
    
    if (alpha == 0.0) {
        discard;
    }
    fragColor = vec4(uColor.rgb, alpha);
}`,
        });

        this.textureData = textureData;
        this.texture = texture;

        this.colorUniform = colorUniform;
    }

    public clear(): void {
        this.textureData.fill(0);
        this.texture.needsUpdate = true;
    }

    public override dispose(): void {
        this.texture.dispose();
        super.dispose();
    }

    public get color(): THREE.Color {
        return new THREE.Color(this.colorUniform.value.x, this.colorUniform.value.y, this.colorUniform.value.z);
    }

    public set color(value: THREE.Color) {
        this.colorUniform.value.x = value.r;
        this.colorUniform.value.y = value.g;
        this.colorUniform.value.z = value.b;
    }

    public get alpha(): number {
        return this.colorUniform.value.w;
    }

    public set alpha(value: number) {
        this.colorUniform.value.w = value;
    }

    public enableCell(cellId: GridCoord): void {
        this.setTexel(cellId, 255);
    }

    public disableCell(cellId: GridCoord): void {
        this.setTexel(cellId, 0);
    }

    private setTexel(position: GridCoord, texelData: number): void {
        const index = this.buildTexelIndex(position);
        this.textureData.set([texelData], index);
        this.texture.needsUpdate = true;
    }

    private buildTexelIndex(position: GridCoord): number {
        if (position.x < 0 || position.z < 0 || position.x >= this.gridSize.x || position.z >= this.gridSize.z) {
            throw new Error(`Out of bounds position "${position.x}x${position.z}" (size is "${this.gridSize.x}x${this.gridSize.z}")`);
        }

        return position.x + position.z * this.gridSize.x;
    }
}

export { PlateauOverlayBlob };
