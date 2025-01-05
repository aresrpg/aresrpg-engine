import * as THREE from '../../libs/three-usage';

import { PropsHandler } from './props-handler';

type Parameters = {
    readonly batchSize?: number;
    readonly minGroupPartSize?: number;
    readonly reactToPlayer?: boolean;
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;

    readonly patchSize: THREE.Vector3Like;
};

type PatchId = THREE.Vector3Like;

function buildPatchIdString(patchId: PatchId): string {
    return `${patchId.x}_${patchId.y}_${patchId.z}`;
}

class PropsViewer extends PropsHandler {
    private readonly patchSize: THREE.Vector3Like;

    public constructor(params: Parameters) {
        super(params);

        this.patchSize = new THREE.Vector3().copy(params.patchSize);
    }

    public setPatchPropsFromLocalMatrices(patchId: THREE.Vector3Like, localMatricesList: ReadonlyArray<THREE.Matrix4>): void {
        const patchWorldOrigin = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
        const patchTransformMatrix = new THREE.Matrix4().makeTranslation(patchWorldOrigin);
        const worldMatricesList = localMatricesList.map(localMatrix =>
            new THREE.Matrix4().multiplyMatrices(patchTransformMatrix, localMatrix)
        );
        this.setPatchPropsFromWorldMatrices(patchId, worldMatricesList);
    }

    public setPatchPropsFromWorldMatrices(patchId: THREE.Vector3Like, worldMatricesList: ReadonlyArray<THREE.Matrix4>): void {
        const patchIdString = buildPatchIdString(patchId);
        this.setGroup(patchIdString, worldMatricesList);
    }

    public deletePatchProps(patchId: THREE.Vector3Like): void {
        const patchIdString = buildPatchIdString(patchId);
        this.deleteGroup(patchIdString);
    }

    public hasPatchProps(patchId: THREE.Vector3Like): boolean {
        const patchIdString = buildPatchIdString(patchId);
        return this.hasGroup(patchIdString);
    }
}

export { PropsViewer };
