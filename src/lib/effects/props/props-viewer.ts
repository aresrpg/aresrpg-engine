import * as THREE from '../../libs/three-usage';

import { PropsHandler, type Parameters as PropsHandlerParameters } from './props-handler';

type Parameters = PropsHandlerParameters & {
    readonly chunkSize: THREE.Vector3Like;
};

type ChunkId = THREE.Vector3Like;

function buildChunkIdString(chunkId: ChunkId): string {
    return `${chunkId.x}_${chunkId.y}_${chunkId.z}`;
}

class PropsViewer extends PropsHandler {
    private readonly chunkSize: THREE.Vector3Like;

    public constructor(params: Parameters) {
        super(params);

        this.chunkSize = new THREE.Vector3().copy(params.chunkSize);
    }

    public setChunkPropsFromLocalMatrices(chunkId: THREE.Vector3Like, localMatricesList: ReadonlyArray<THREE.Matrix4>): void {
        const chunkWorldOrigin = new THREE.Vector3().multiplyVectors(chunkId, this.chunkSize);
        const chunkTransformMatrix = new THREE.Matrix4().makeTranslation(chunkWorldOrigin);
        const worldMatricesList = localMatricesList.map(localMatrix =>
            new THREE.Matrix4().multiplyMatrices(chunkTransformMatrix, localMatrix)
        );
        this.setChunkPropsFromWorldMatrices(chunkId, worldMatricesList);
    }

    public setChunkPropsFromWorldMatrices(chunkId: THREE.Vector3Like, worldMatricesList: ReadonlyArray<THREE.Matrix4>): void {
        const chunkIdString = buildChunkIdString(chunkId);
        this.setGroup(chunkIdString, worldMatricesList);
    }

    public deleteChunkProps(chunkId: THREE.Vector3Like): void {
        const chunkIdString = buildChunkIdString(chunkId);
        this.deleteGroup(chunkIdString);
    }

    public hasChunkProps(chunkId: THREE.Vector3Like): boolean {
        const chunkIdString = buildChunkIdString(chunkId);
        return this.hasGroup(chunkIdString);
    }
}

export { PropsViewer };
