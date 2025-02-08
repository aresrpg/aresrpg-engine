import * as THREE from '../libs/three-usage';

function createFullscreenQuad(attributeName: string): THREE.Mesh {
    const fullscreenQuadGeometry = new THREE.BufferGeometry();
    fullscreenQuadGeometry.name = 'fullscreen-quad-geometry';
    fullscreenQuadGeometry.setAttribute(attributeName, new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    fullscreenQuadGeometry.setDrawRange(0, 6);
    const fullscreenQuad = new THREE.Mesh(fullscreenQuadGeometry);
    fullscreenQuad.name = 'fullscreenq-quad-mesh';
    fullscreenQuad.frustumCulled = false;
    return fullscreenQuad;
}

export { createFullscreenQuad };
