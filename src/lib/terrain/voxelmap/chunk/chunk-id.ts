import { vec3ToString } from '../../../helpers/string';
import type * as THREE from '../../../libs/three-usage';

class ChunkId {
    public readonly x: number;
    public readonly y: number;
    public readonly z: number;

    public readonly asString: string;

    public constructor(id: THREE.Vector3Like) {
        this.x = id.x;
        this.y = id.y;
        this.z = id.z;

        this.asString = vec3ToString(this, '_');
    }
}

export { ChunkId };
