import type * as THREE from '../libs/three-usage';

function copyMap<T, U>(source: ReadonlyMap<T, U>, destination: Map<T, U>): void {
    destination.clear();
    for (const [key, value] of source.entries()) {
        destination.set(key, value);
    }
}

function disableMatrixAutoupdate(object: THREE.Object3D): void {
    object.matrixAutoUpdate = false; // do not always update world matrix in updateMatrixWorld()
    object.matrixWorldAutoUpdate = false; // tell the parent to not always call updateMatrixWorld()
}

export { copyMap, disableMatrixAutoupdate };
