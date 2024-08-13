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
    private readonly colorUniform: THREE.IUniform<THREE.Color>;

    public constructor(params: Parameters) {
        const marginUniform = { value: params.margin ?? 0.05 };
        const borderThicknessUniform = { value: params.borderThickness ?? 0.03 };
        const innerCornerRadiusUniform = { value: params.innerCornerRadius ?? 0.2 };
        const colorUniform = { value: params.color ?? new THREE.Color(0xffffff) };

        super({
            name: 'blob',
            size: params.size,
            uniforms: {
                uMargin: marginUniform,
                uBorderThickness: borderThicknessUniform,
                uInnerCornerRadius: innerCornerRadiusUniform,
                uColor: colorUniform,
            },
            fragmentShader: `
uniform sampler2D uDataTexture;
uniform float uMargin;
uniform float uBorderThickness;
uniform float uInnerCornerRadius;
uniform vec3 uColor;

in vec2 vGridCell;
out vec4 fragColor;

bool isCellOn(const ivec2 cellId) {
    vec4 data = texelFetch(uDataTexture, cellId, 0);
    return data.a > 0.0;
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

    const float alphaCenter = 0.7;
    const float alphaBorder = 0.9;

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
    fragColor = vec4(uColor, alpha);
}`,
        });

        this.colorUniform = colorUniform;
    }

    public get color(): THREE.Color {
        return this.colorUniform.value;
    }

    public set color(value: THREE.Color) {
        this.colorUniform.value = value;
    }

    public enableCell(cellId: GridCoord): void {
        this.setTexel(cellId, [255, 255, 255, 255]);
    }

    public disableCell(cellId: GridCoord): void {
        this.setTexel(cellId, [0, 0, 0, 0]);
    }
}

export { PlateauOverlayBlob };
