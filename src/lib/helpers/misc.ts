import * as THREE from '../libs/three-usage';

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

function buildNoiseTexture(resolution: number): THREE.DataTexture {
    const textureWidth = resolution;
    const textureHeight = resolution;
    const textureData = new Uint8Array(textureWidth * textureHeight);

    for (let i = 0; i < textureData.length; i++) {
        textureData[i] = Math.floor(256 * Math.random());
    }

    const dataTexture = new THREE.DataTexture(textureData, textureWidth, textureHeight, THREE.RedFormat);
    dataTexture.needsUpdate = true;
    return dataTexture;
}

export { buildNoiseTexture, copyMap, disableMatrixAutoupdate };
