import { type MeshesStatistics } from '../../helpers/meshes-statistics';
import type * as THREE from '../../libs/three-usage';

type HeightmapStatistics = MeshesStatistics;

interface IHeightmapViewer {
    readonly container: THREE.Object3D;

    readonly basePatchSize: number;

    focusPoint: THREE.Vector2Like;
    focusDistance: number;
    visibilityDistance: number;

    wireframe: boolean;

    update(renderer: THREE.WebGLRenderer): void;
    setHiddenPatches(patches: ReadonlyArray<{ x: number; z: number }>): void;
    getStatistics(): HeightmapStatistics;
}

export { type HeightmapStatistics, type IHeightmapViewer };
