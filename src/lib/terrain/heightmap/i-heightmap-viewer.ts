import type * as THREE from '../../libs/three-usage';

type PatchId = {
    readonly x: number;
    readonly z: number;
};

interface IHeightmapViewer {
    readonly container: THREE.Object3D;

    readonly basePatchSize: number;

    enabled: boolean;

    focusPoint: THREE.Vector2Like;
    focusDistance: number;
    visibilityDistance: number;

    wireframe: boolean;

    update(renderer: THREE.WebGLRenderer): void;
    setHiddenPatches(patches: Iterable<PatchId>): void;
    getStatistics(): object;
}

export type { IHeightmapViewer, PatchId };
