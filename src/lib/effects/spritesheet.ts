import type * as THREE from '../libs/three-usage';

type Spritesheet = {
    readonly texture: THREE.Texture;
    readonly size: THREE.Vector2Like;
};

export { type Spritesheet };
