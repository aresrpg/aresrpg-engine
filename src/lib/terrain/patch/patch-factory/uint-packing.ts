type PackedUintFragment = {
    readonly maxValue: number;
    encode(value: number): number;
    glslDecode(varname: string): string;
    glslDecodeWithShift(varname: string, shiftAsString: string): string;
};

class PackedUintFactory {
    private readonly totalAllowedBits: number;
    private nextAvailableBit: number = 0;

    public constructor(totalAllowedBits: number) {
        this.totalAllowedBits = totalAllowedBits;
    }

    public encodePart(nbValues: number): PackedUintFragment {
        const shift = this.nextAvailableBit;
        const bitsCount = this.computeBitsNeeeded(nbValues);
        this.nextAvailableBit += bitsCount;
        if (this.nextAvailableBit > this.totalAllowedBits) {
            throw new Error("Does not fit");
        }
        const maxValue = (1 << bitsCount) - 1;

        return {
            maxValue,
            encode: (value: number) => {
                if (value < 0 || value > maxValue) {
                    throw new Error("Out of range");
                }
                return value << shift;
            },
            glslDecode: (varname: string) => {
                return `((${varname} >> ${shift}u) & ${maxValue}u)`;
            },
            glslDecodeWithShift: (varname: string, additionalShiftAsString: string) => {
                return `((${varname} >> (${shift}u + ${additionalShiftAsString})) & ${maxValue}u)`;
            },
        };
    }

    public getNextAvailableBit(): number {
        return this.nextAvailableBit;
    }

    private computeBitsNeeeded(nbValues: number): number {
        for (let i = 1; i < this.totalAllowedBits; i++) {
            if (1 << i >= nbValues) {
                return i;
            }
        }
        throw new Error(`${this.totalAllowedBits} bits is not enough to store ${nbValues} values`);
    }
}

export {
    PackedUintFactory,
    type PackedUintFragment
};

