import * as THREE from "../../three-usage";

class PatchId {
    public readonly x: number;
    public readonly y: number;
    public readonly z: number;

    public readonly asString: string;

    public constructor(id: THREE.Vector3Like) {
        this.x = id.x;
        this.y = id.y;
        this.z = id.z;

        this.asString = `${this.x}_${this.y}_${this.z}`;
    }
}

export {
    PatchId,
};
