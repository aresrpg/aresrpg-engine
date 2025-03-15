type PackedUintFragment = {
    readonly maxValue: number;
    encode(value: number): number;
    decode(value: number): number;
    wgslEncode(varname: string): string;
    wgslDecode(varname: string): string;
    glslDecode(varname: string): string;
    serialize(): string;
};

class PackedUintFactory {
    private readonly totalAllowedBits: number;
    private nextAvailableBit: number = 0;

    public constructor(totalAllowedBits: number) {
        this.totalAllowedBits = totalAllowedBits;
    }

    public encodeNValues(valuesCount: number): PackedUintFragment {
        const bitsCount = this.computeBitsNeeded(valuesCount);
        return this.encodeNBits(bitsCount);
    }

    public encodeNBits(bitsCount: number): PackedUintFragment {
        const shift = this.nextAvailableBit;
        this.nextAvailableBit += bitsCount;
        if (this.nextAvailableBit > this.totalAllowedBits) {
            throw new Error('Does not fit');
        }
        const maxValue = (1 << bitsCount) - 1;

        const result = {
            maxValue,
            shift,
            encode(value: number) {
                if (value < 0 || value > this.maxValue) {
                    throw new Error('Out of range');
                }
                return value << this.shift;
            },
            decode(value: number) {
                return (value >> this.shift) & this.maxValue;
            },
            wgslEncode(varname: string) {
                return `(${varname} << ${this.shift}u)`;
            },
            wgslDecode(varname: string) {
                return `((${varname} >> ${this.shift}u) & ${this.maxValue}u)`;
            },
            glslDecode(varname: string) {
                return `((${varname} >> ${this.shift}u) & ${this.maxValue}u)`;
            },
            serialize() {
                return `{
            maxValue: ${result.maxValue},
            shift: ${result.shift},
            ${result.encode},
            ${result.decode},
        }`;
            },
        };

        return result;
    }

    public getNextAvailableBit(): number {
        return this.nextAvailableBit;
    }

    private computeBitsNeeded(nbValues: number): number {
        for (let i = 1; i < this.totalAllowedBits; i++) {
            if (1 << i >= nbValues) {
                return i;
            }
        }
        throw new Error(`${this.totalAllowedBits} bits is not enough to store ${nbValues} values`);
    }
}

export { PackedUintFactory, type PackedUintFragment };
