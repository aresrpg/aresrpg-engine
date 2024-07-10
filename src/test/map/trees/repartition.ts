import * as THREE from "three";

type TreePosition = {
    position: THREE.Vector2Like;
    probability: number;
};

class TreeRepartition {
    private readonly size: number;
    private readonly data: Uint8Array;

    public constructor(patternSize: number, minSpacing: number) {
        this.size = patternSize;
        this.data = new Uint8Array(this.size * this.size);

        const itemSurface = minSpacing * minSpacing;

        const treesCount = this.data.length / itemSurface * 2000;
        for (let i = 0; i < treesCount; i++) {
            const x = Math.floor(this.size * Math.random());
            const z = Math.floor(this.size * Math.random());

            const neighbourXFrom = x - minSpacing;
            const neighbourXTo = x + minSpacing;
            const neighbourZFrom = z - minSpacing;
            const neighbourZTo = z + minSpacing;

            let isTooClose = false;
            for (let iNZ = neighbourZFrom; iNZ < neighbourZTo && !isTooClose; iNZ++) {
                for (let iNX = neighbourXFrom; iNX < neighbourXTo && !isTooClose; iNX++) {
                    const index = this.buildIndex(this.safeModulo(iNX, this.size), this.safeModulo(iNZ, this.size));
                    const neighbour = this.data[index];
                    if (typeof neighbour === "undefined") {
                        throw new Error();
                    }
                    if (neighbour > 0) {
                        isTooClose = true;
                    }
                }
            }

            if (!isTooClose) {
                const proba = Math.random();

                const index = this.buildIndex(x, z);
                this.data[index] = Math.floor(255 * proba);
            }
        }
    }

    public getAllTrees(from: THREE.Vector2Like, to: THREE.Vector2Like): TreePosition[] {
        const result: TreePosition[] = [];

        for (let iZ = from.y; iZ < to.y; iZ++) {
            for (let iX = from.x; iX < to.x; iX++) {
                const probability = this.getTreeProbability(iX, iZ);
                if (probability > 0) {
                    result.push({
                        position: { x: iX, y: iZ },
                        probability,
                    });
                }
            }
        }

        return result;
    }

    private getTreeProbability(x: number, z: number): number {
        x = this.safeModulo(x, this.size);
        z = this.safeModulo(z, this.size);

        const index = this.buildIndex(x, z);
        const value = this.data[index];
        if (typeof value === "undefined") {
            throw new Error();
        }
        return value / 256;
    }

    private buildIndex(x: number, z: number): number {
        return x + this.size * z;
    }

    private safeModulo(n: number, m: number): number {
        return ((n % m) + m) % m;
    }
}


export { TreeRepartition, type TreePosition };

