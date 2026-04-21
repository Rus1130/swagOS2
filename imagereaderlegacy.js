    class ImageReader {
        static imgOffsetAmount = 200;

        constructor(type, content) {
            this.type = type;

            const parsed = this.parse(content);

            this.width = parsed.width;
            this.height = parsed.height;
            this.palette = parsed.palette || [];
            this.pixels = parsed.pixels;
        }

        // -------------------------
        // PARSING LAYER (UNIFIED)
        // -------------------------
        parse(content) {
            switch (this.type) {
                case "bpal":
                    return this.parseBPal(content);
                case "bmap":
                    return this.parseBMap(content);
                case "img":
                    return this.parseImg(content);
                default:
                    throw new Error(`Unsupported image type: ${this.type}`);
            }
        }

        parseBPal(content) {
            const width = +content[1];
            const height = +content[2];
            const colorCount = +content[3];

            if (colorCount > 36) {
                throw new Error("Color count exceeds maximum of 36");
            }

            const palette = content
                .slice(4, 4 + colorCount)
                .map(c => c.replace("#", ""));

            const flat = content[4 + colorCount]
                .split(" ")
                .map(x => parseInt(x, 36));

            const pixels = [];
            for (let y = 0; y < height; y++) {
                pixels.push(flat.slice(y * width, (y + 1) * width));
            }

            return { width, height, palette, pixels };
        }

        parseBMap(content) {
            const width = +content[1];
            const height = +content[2];

            const pixels = content.slice(3).map(row =>
                row.split(" ").map(hex => hex.replace("#", ""))
            );

            return { width, height, palette: [], pixels };
        }

        parseImg(content) {
            const meta = content[0];

            const palette = (meta.palette || []).map(c => c.replace("#", ""));
            const pixels = meta.data;

            const width = +content[1];
            const height = meta.height ?? pixels.length;

            return { width, height, palette, pixels };
        }

        // -------------------------
        // ENCODE
        // -------------------------
        static encodeImage(hex2DArray) {
            const colorFrequency = {};

            for (const row of hex2DArray) {
                for (const val of row) {
                    const color = val.replace("#", "");
                    colorFrequency[color] = (colorFrequency[color] || 0) + 1;
                }
            }

            const palette = Object.entries(colorFrequency)
                .sort((a, b) => b[1] - a[1])
                .map(x => x[0]);

            const paletteMap = {};
            palette.forEach((c, i) => paletteMap[c] = i);

            const indexed = hex2DArray.map(row =>
                row.map(val => paletteMap[val.replace("#", "")] + 2)
            );

            // RLE compression
            const rle = [];

            for (let y = 0; y < indexed.length; y++) {
                const row = indexed[y];
                let out = [];

                let run = 1;

                for (let x = 0; x < row.length; x++) {
                    if (x === 0) {
                        out.push(row[x]);
                    } else if (row[x] === row[x - 1]) {
                        run++;
                    } else {
                        if (run > 1) {
                            out.push(0, run);
                        }
                        out.push(row[x]);
                        run = 1;
                    }
                }

                if (run > 1) out.push(0, run);

                out.push(1); // end row marker
                rle.push(out);
            }

            const bytes = this.hex2DArrayToBytes(rle);
            const compressed = pako.deflate(bytes);

            const data = Array.from(compressed)
                .map(x => String.fromCharCode(x + this.imgOffsetAmount))
                .join("");

            return {
                palette,
                data
            };
        }

        static hex2DArrayToBytes(arr) {
            return new Uint8Array(arr.flat());
        }

        static deflate(bytes) {
            return pako.deflate(bytes);
        }

        static inflate(bytes) {
            return pako.inflate(bytes);
        }

        // -------------------------
        // DECODE
        // -------------------------
        decodeImage(encodedString) {
            const bytes = Array.from(
                ImageReader.inflate(
                    new Uint8Array(
                        encodedString.map(c =>
                            c.charCodeAt(0) - ImageReader.imgOffsetAmount
                        )
                    )
                )
            );

            const pixels = [];
            let row = [];

            for (let i = 0; i < bytes.length; i++) {
                const v = bytes[i];

                if (v === 0) {
                    const count = bytes[++i];
                    const last = row[row.length - 1];

                    for (let j = 0; j < count - 1; j++) {
                        row.push(last);
                    }

                } else if (v === 1) {
                    pixels.push(row);
                    row = [];

                } else {
                    row.push(v);
                }
            }

            return pixels.map(r =>
                r.map(idx => "#" + this.palette[idx - 2])
            );
        }

        // -------------------------
        // READ OUTPUT
        // -------------------------
        read() {
            if (!this.pixels) {
                throw new Error("No pixel data found");
            }

            if (this.type === "img") {
                return this.decodeImage(this.pixels);
            }

            return this.pixels.map(row =>
                row.map(val =>
                    typeof val === "number"
                        ? val
                        : "#" + val
                )
            );
        }

        // -------------------------
        // EXPORT
        // -------------------------
        toFile(stringify = false) {
            let result;

            if (this.type === "bpal") {
                result = [
                    this.type,
                    this.width,
                    this.height,
                    this.palette.length,
                    ...this.palette,
                    this.pixels
                ];
            } else if (this.type === "bmap") {
                result = [
                    this.type,
                    this.width,
                    this.height,
                    ...this.pixels
                ];
            } else if (this.type === "img") {
                result = [
                    this.type,
                    this.palette.length,
                    ...this.palette,
                    this.pixels,
                    this.width
                ];
            }

            return stringify ? JSON.stringify(result) : result;
        }
    }
