import type * as THREE from '../libs/three-usage';

function vec2ToString(vec3: THREE.Vector2Like, separator: string = 'x'): string {
    return `${vec3.x}${separator}${vec3.y}`;
}

function vec3ToString(vec3: THREE.Vector3Like, separator: string = 'x'): string {
    return `${vec3.x}${separator}${vec3.y}${separator}${vec3.z}`;
}

function applyReplacements(source: string, replacements: Record<string, string>): string {
    let result = source;

    for (const [source, replacement] of Object.entries(replacements)) {
        result = result.replace(source, replacement);
    }

    return result;
}

export { applyReplacements, vec2ToString, vec3ToString };
