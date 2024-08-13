import type * as THREE from '../../../../three-usage';

import { type GridCoord, PlateauOverlay } from './plateau-overlay';

type Parameters = {
    readonly size: GridCoord;
    readonly margin?: number;
    readonly innerCornerRadius?: number;
};

class PlateauOverlaySquares extends PlateauOverlay {
    public constructor(params: Parameters) {
        const marginUniform = { value: params.margin ?? 0.05 };
        const innerCornerRadiusUniform = { value: params.innerCornerRadius ?? 0.2 };

        super({
            name: 'blob',
            size: params.size,
            uniforms: {
                uMargin: marginUniform,
                uInnerCornerRadius: innerCornerRadiusUniform,
            },
            fragmentShader: `uniform sampler2D uDataTexture;
uniform float uMargin;
uniform float uInnerCornerRadius;

in vec2 vGridCell;
out vec4 fragColor;

void main(void) {
    ivec2 gridCellId = ivec2(floor(vGridCell));
    vec2 uv = fract(vGridCell);

    vec4 data = texelFetch(uDataTexture, gridCellId, 0);
    if (data.a == 0.0) {
        discard;
    }

    float border = 0.0;
    float r2 = 0.5 - uMargin;
    float r1 = r2 - border - uInnerCornerRadius;

    vec2 dCenter = max(vec2(0), abs(uv - 0.5) - r1);
    float dist = length(dCenter);

    float alpha = step(dist, r2 - r1);

    if (alpha == 0.0) {
        discard;
    }
    fragColor = vec4(data.rgb, alpha);
}`,
        });
    }

    public enableCell(cellId: GridCoord, color: THREE.Color): void {
        this.setTexel(cellId, [Math.floor(255 * color.r), Math.floor(255 * color.g), Math.floor(255 * color.b), 255]);
    }

    public disableCell(cellId: GridCoord): void {
        this.setTexel(cellId, [0, 0, 0, 0]);
    }
}

export { PlateauOverlaySquares };
