import IMAGES from "./longfiles.js";

class ImageReader {
    static imgOffsetAmount = 200;

    // =========================
    // ENCODE
    // =========================
    static encodeImage(reader) {
        // deep copy so we NEVER mutate original data
        const bitmap = reader.bitmap.map(row => row.slice());
        const palette = reader.palette.map(c => c.replace("#", ""));

        // convert hex colors → palette indices
        for (let y = 0; y < bitmap.length; y++) {
            const row = bitmap[y];

            for (let x = 0; x < row.length; x++) {
                const val = row[x].replace("#", "");
                const index = palette.indexOf(val);

                if (index === -1) {
                    throw new OSError("Color not found in palette");
                }

                row[x] = index + 2; // reserve 0,1 for control codes
            }
        }

        // run-length encoding
        let rle = [];

        for (let y = 0; y < bitmap.length; y++) {
            const row = bitmap[y];
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

            if (run > 1) {
                out.push(0, run);
            }

            out.push(1); // end of row
            rle.push(out);
        }

        const bytes = ImageReader.hex2DArrayToBytes(rle);
        const compressed = ImageReader.deflate(bytes);

        return Array.from(compressed)
            .map(x => String.fromCharCode(x + ImageReader.imgOffsetAmount))
            .join("");
    }

    // =========================
    // DECODE (optional future fix)
    // =========================
    static decodeImage(file) {

        const data = file[file[1] + 2];

        let palette = file.slice(2, 2 + file[1])
            .map(c => c.replace("#", ""));


        if (typeof data !== "string") {
            throw new Error("Invalid compressed data");
        }

        const bytes = Array.from(
            ImageReader.inflate(
                new Uint8Array(
                    data.split("").map(c =>
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
            r.map(idx => "#" + palette[idx - 2])
        );
    }
    // =========================
    static hex2DArrayToBytes(arr) {
        return new Uint8Array(arr.flat());
    }

    static deflate(bytes) {
        return pako.deflate(bytes);
    }

    static inflate(bytes) {
        return pako.inflate(bytes);
    }

    // =========================
    constructor(type, array2D) {
        if (!Array.isArray(array2D) || array2D.some(r => !Array.isArray(r))) {
            throw new OSError("Invalid image data (0)");
        }

        if (array2D.length === 0 || array2D[0].length === 0) {
            throw new OSError("Invalid image data (1)");
        }

        this.type = type;
        this.height = array2D.length;
        this.width = array2D[0].length;

        // IMPORTANT: store raw reference, but never mutate it
        this.bitmap = array2D;

        const colorFrequency = {};
        for (let row of array2D) {
            for (let color of row) {
                colorFrequency[color] = (colorFrequency[color] || 0) + 1;
            }
        }

        this.palette = Object.entries(colorFrequency)
            .sort((a, b) => b[1] - a[1])
            .map(x => x[0]);
    }

    // =========================
    toFile(stringify = false) {
        let fileContent;

        switch (this.type) {
            case "bmap": {

                if(this.width != this.bitmap[0].length){
                    throw new OSError("Inconsistent row lengths in bitmap data");
                }

                if(this.height != this.bitmap.length){
                    throw new OSError("Height does not match number of rows in bitmap data");
                }

                fileContent = [
                    "bmap",
                    this.width,
                    this.height,
                    this.bitmap.map(row => row.join(" "))
                ];
            } break;

            case "img": {
                const data = ImageReader.encodeImage(this);

                fileContent = [
                    "img",
                    this.palette.length,
                    ...this.palette,
                    data,
                ];
                break;
            }
        }

        return stringify ? JSON.stringify(fileContent) : fileContent;
    }
}

class ColorService {
    static enabled = false;
    static os = null;

    static init(os) {
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("ColorService_init");
        ColorService.update();
    }

    static enable() {
        this.enabled = true;
        DiagnosticService.record("ColorService_enable");
    }

    static disable() {
        this.enabled = false;
        DiagnosticService.record("ColorService_disable");
    }

    static update(){
        if(!this.enabled) return;

        const palette = ConfigService.get("color_palette", false);

        if(palette === undefined || palette === null || palette === ""){
            throw new OSError("Color palette is not defined in /config/user.conf");
        }

        const paletteFile = FilesystemService.resolvePath(`/data/palettes/${palette}.conf`, "file");

        if(!paletteFile) throw new OSError("Palette configuration file not found at /config/palette.conf");

        const paletteData = new SwagObjectParser(paletteFile.read()).parse();

        if(paletteData.palette === undefined) throw new OSError("Palette configuration file is missing 'palette' property");
        if(paletteData.definitions === undefined) throw new OSError("Palette configuration file is missing 'definitions' property");

        this.palette = paletteData.palette;
        this.definitions = paletteData.definitions;

        for(const [key, value] of Object.entries(paletteData.palette)){
            document.documentElement.style.setProperty(`--color_${key}`, value);
        }

        for(const [key, value] of Object.entries(paletteData.definitions)){

            if(this.palette[value] === undefined && value !== "transparent"){
                throw new OSError(`Palette definition "${key}" references unknown color "${value}"`);
            }

            if(value === "transparent") document.documentElement.style.setProperty(`--${key}`, "transparent");
            else document.documentElement.style.setProperty(`--${key}`, `var(--color_${value})`);
        }
    }

    static getPalette(){
        if(!this.enabled) throw new OSError("ColorService is disabled");
        DiagnosticService.record("ColorService_getPalette");
        return structuredClone(this.palette);
    }

    static getColor(hexColor){
        if(!this.enabled) throw new OSError("ColorService is disabled");
       //  DiagnosticService.record("ColorService_getColor");

        if(hexColor === "transparent") return "transparent";

        const target = this.hexToRgb(hexColor);

        let closestColor = null;
        let closestDistance = Infinity;

        const palette = Object.values(this.palette).map(c => this.hexToRgb(c));

        for(const name in palette){
            const rgb = palette[name];

            const dr = rgb.r - target.r;
            const dg = rgb.g - target.g;
            const db = rgb.b - target.b;

            const distance = dr*dr + dg*dg + db*db;

            if(distance < closestDistance){
                closestDistance = distance;
                closestColor = name;
            }
        }

        return this.rgbToHex(palette[closestColor]);
    }

    static hexToRgb(hex) {
        const h = hex.startsWith("#") ? hex.slice(1) : hex;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }

    static rgbToHex(object) {
        return `#${object.r.toString(16).padStart(2,"0")}${object.g.toString(16).padStart(2,"0")}${object.b.toString(16).padStart(2,"0")}`;
    }
}

class ConfigService {
    static #config = null;
    static os = null;
    static enabled = false;

    static init(os){
        if(this.os) return;
        this.enabled = true;
        this.os = os;
        DiagnosticService.record("ConfigService_init");
        this.#config = new SwagObjectParser(FilesystemService.resolvePath("/config/user.conf").read()).parse();
    }

    static enable(){
        this.enabled = true;
        DiagnosticService.record("ConfigService_enable");
    }

    static disable(){
        this.enabled = false;
        DiagnosticService.record("ConfigService_disable");
    }

    static initialized(){
        return this.#config !== null;
    }

    static get(key, log = true){
        if(!this.#config) throw new OSError("ConfigService is not initialized");
        if(!this.enabled) throw new OSError("ConfigService is not enabled", 1);
        if(log) DiagnosticService.record(`ConfigService_get ${key}`);

        if(this.#config[key] == undefined) throw new OSError(`Config key "${key}" is not defined in /config/user.conf`);

        return this.#config[key]
    }

    static getAll(){
        if(!this.#config) throw new OSError("ConfigService is not initialized");
        if(!this.enabled) throw new OSError("ConfigService is not enabled", 1);

        return structuredClone(this.#config);
    }

    static reload(){
        if(!this.#config) throw new OSError("ConfigService is not initialized");
        if(!this.enabled) throw new OSError("ConfigService is not enabled", 1);
        DiagnosticService.record("ConfigService_reload");
        try {
            this.#config = new SwagObjectParser(FilesystemService.resolvePath("/config/user.conf").read()).parse();
            ColorService.update();
        } catch (e) {
            if(e instanceof OSError) throw e;
            else throw new OSError(`Failed to reload config`, 1);
        }
    }
}

class NoValue {
    constructor(){}
}

class CommandService {
    static os = null;
    static enabled = false;
    static commands = new Map();
    static registeredCommands = new Set();

    static init(os) {
        if(this.os) return;
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("CommandService_init");
    }

    static enable(){
        this.enabled = true;
        DiagnosticService.record("CommandService_enable");
    }

    static disable(){
        this.enabled = false;
        DiagnosticService.record("CommandService_disable");
    }

    /**
     * 
     * @param {string}
     * @param {*} body 
     * @param {*} fn 
     * @returns 
     */
    static defineCommand(name, body, fn){
        if(!this.enabled) return;
        this.commands.set(name, {body, fn});
        // DiagnosticService.record(`CommandService_define ${name}`);

        if(body.options && body.options.alias){
            let aliasBody = structuredClone(body);
            delete aliasBody.options.alias;

            aliasBody.aliasOf = name;
            this.commands.set(body.options.alias, {body: aliasBody, fn});
        }
    }

    static reloadCommands(){
        this.registeredCommands = new Set();
        this.commands = new Map();
        defineCommands();
        this.os.validateAllCommands();
    }

    static getCommand(name){
        if(!this.enabled) return;
        if(!Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().includes(name)) return null;
        DiagnosticService.record(`CommandService_get ${name}`);
        return this.commands.get(name);
    }

    static listCommands(){
        if(!this.enabled) return;
        return Array.from(CommandService.registeredCommands);
    }

    static unregisterCommand(name){
        if(!this.enabled) return;
        if(!Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().includes(name)) return;
        const entry = this.commands.get(name);
        if(!entry) throw new Error(`Cannot unregister unknown command: "${name}"`);

        const commandNames = [];

        commandNames.push(name);
        if(entry.body.options.alias) commandNames.push(entry.body.options.alias);

        DiagnosticService.record(`CommandService_unregister ${name}`);
        commandNames.forEach(n => this.registeredCommands.forEach(set => set.delete(n)));
    }

    static registerCommand(name){
        if(!this.enabled) return;
        if(CommandService.registeredCommands.has(name)) return;
        const entry = this.commands.get(name);
        if(!entry) throw new Error(`Cannot register unknown command: "${name}"`);

        const commandNames = new Set();

        commandNames.add(name);
        if(entry.body.options.alias) commandNames.add(entry.body.options.alias);

        // DiagnosticService.record(`CommandService_register ${name}`);
        CommandService.registeredCommands.add(commandNames);
    }

    static validateCommand(name){
        if(!this.enabled) return;
        if(!this.commands.has(name)) throw new Error(`Cannot validate unknown command: "${name}"`);

        const entry = this.commands.get(name);

        DiagnosticService.record(`CommandService_validate ${name}`);

        entry.body.schema.forEach(param => {
            if(param.type === "flag"){
                if(param.datatype === undefined || !["boolean", "string", "number"].includes(param.datatype)){
                    CommandService.unregisterCommand(name);
                    this.os.error(`Invalid schema for command "${name}": Flag "${param.name}" has invalid or missing datatype (must be "boolean", "string", or "number")`);
                }
            }
        });
    }

    static bulkRegister(names){
        if(!this.enabled) return;
        for(const name of names){
            this.registerCommand(name);
        }
    }

    static bulkUnregister(names){
        if(!this.enabled) return;
        for(const name of names){
            this.unregisterCommand(name);
        }
    }

    static verify(name, args, flags){
        if(!this.enabled) return;
        const entry = this.commands.get(name);

        let verificationReturn = { valid: true, error: null, flags: {} };

        DiagnosticService.record(`CommandService_verify ${name}`);

        if(!entry){
            return { valid: false, error: `Unknown command: "${name}"` };
        }

        const schema = entry.body.schema || [];

        const positionalSchema = schema.filter(s => s.type === "positional");
        const flagSchema = schema.filter(s => s.type === "flag" || s.type === "option");

        for(const [key, value] of Object.entries(flags)){
            // remove the short name from the flags object if it exists
            const flagDef = flagSchema.find(s => s.short === key);
            flags[flagDef ? flagDef.name : key] = value;
            if(flagDef && flags[flagDef.short]) delete flags[flagDef.short];
        }

        let positionalIndex = 0;

        for(const param of positionalSchema){
            const required = param.required || false;
            if(required && positionalIndex >= args.length){
                return { valid: false, error: `Missing required argument: "${param.name}"` };
            }
            if(param.options && !param.options.includes(args[positionalIndex])){
                return { valid: false, error: `Invalid value for argument "${param.name}": expected one of "${param.options.join("\", \"")}", got "${args[positionalIndex]}"` };
            }
            positionalIndex++;
        }

        for(const param of flagSchema){
            if(param.required && flags[param.name] === undefined && flags[param.short] === undefined){
                return { valid: false, error: `Missing required flag: "--${param.name}"` };
            }
        }

        for(const flagName of Object.keys(flags)){
            const flagDef = flagSchema.find(s => s.name === flagName || s.short === flagName);
            if(!flagDef) continue;

            const hasFlag = flags[flagName] !== undefined;

            if (!hasFlag) {
                if (flagDef.required) {
                    return { valid: false, error: `Missing required flag: "--${flagName}"` };
                }
                continue;
            }

            let flagValue = flags[flagName];
            let expectedType = flagDef.datatype;
            let actualType = typeof flagValue;

            if(flagValue instanceof NoValue && expectedType == "boolean"){
                flagValue = true;
                actualType = "boolean";
            }

            if(flagValue instanceof NoValue && flagDef.default === undefined){
                return { valid: false, error: `Flag "--${flagName}" requires a value of type ${expectedType}` };
            }
            
            if(flagValue instanceof NoValue && flagDef.default !== undefined){
                flagValue = flagDef.default;
                actualType = typeof flagValue;
            }

            if(actualType !== expectedType){
                return { valid: false, error: `Invalid value type for flag "--${flagName}": expected ${expectedType}, got ${actualType}` };
            }


            if(verificationReturn.flags[flagDef.name] === undefined){
                verificationReturn.flags[flagDef.name] = flagValue;
            }
        }

        return verificationReturn;
    }
}

class FilesystemService {
    static enabled = false;
    static root = null;
    static currentDirectory = null;
    static workingDirectory = "/";

    static init() {
        if (this.root) return;
        this.root = new OSDirectory("root");
        this.currentDirectory = this.root;
        this.enabled = true;
        DiagnosticService.record("FilesystemService_init");
    }

    static enable() {
        if (this.enabled) return;
        this.enabled = true;
        DiagnosticService.record("FilesystemService_enable");
    }

    static disable() {
        if (!this.enabled) return;
        this.enabled = false;
        DiagnosticService.record("FilesystemService_disable");
    }

    static remove(path){
        if (!this.enabled) throw new OSError("FilesystemService is disabled");

        const node = this.resolvePath(path, "full");

        if (!node) throw new OSError(`Path not found: "${path}"`);

        if (node.parent) {
            const fullPath = structuredClone(node.fullPath());
            DiagnosticService.record(`FilesystemService_remove ${path}`);
            node.parent.children.delete(
                node instanceof OSFile ? `${node.name}.${node.type}` : node.name
            );
            return fullPath;
        } else {
            throw new OSError(`Cannot remove root directory`);
        }
    }

    /**
     * 
     * @param {string} path 
     * @param {"file"|"directory"|"full"|"none"} assumption
     * @returns 
     */
    static resolvePath(path, assumption = "none") {
    if (!this.enabled) throw new OSError("FilesystemService is disabled");

    const parts = path.split("/").filter(p => p.length > 0);
    let node = path.startsWith("/") ? this.root : this.currentDirectory;

    for (const rawPart of parts) {
        if (rawPart === ".") continue;
        if (rawPart === "..") {
            node = node.parent ?? node;
            continue;
        }

        if (!(node instanceof OSDirectory)) return null;

        // Extract name and type from the path segment (e.g. foo.txt → ["foo", "txt"])

        const [givenName, givenType] = rawPart.split(".");

        const children = node.children;

        //
        // === ASSUMPTION MODE: "none" ===
        //
        if (assumption === "none") {
            const fullName = givenType ? `${givenName}.${givenType}` : givenName;

            if (!children.has(fullName)) return null;

            node = children.get(fullName);
            continue;
        }

        //
        // === ASSUMPTION MODES WITH PARTIAL MATCHING ===
        //
        const matches = [];

        for (const [childName, child] of children) {
            const fileName = childName.split(".")[0]; // real name
            const fileType = child instanceof OSFile ? child.type : null;

            const starts = fileName.startsWith(givenName);

            //
            // ---- DIRECTORY handling ----
            //
            if (child instanceof OSDirectory) {
                if (assumption === "file") {
                    // directories require exact match only
                    if (childName === givenName) matches.push(child);
                } else {
                    // "directory" or "full": allow partial match
                    if (starts) matches.push(child);
                }
                continue;
            }

            //
            // ---- FILE handling ----
            //
            if (child instanceof OSFile) {
                if (assumption === "directory") {
                    // files require exact name+type under directory assumption
                    if (fileName === givenName && fileType === givenType) {
                        matches.push(child);
                    }
                    continue;
                }

                if (assumption === "file" || assumption === "full") {
                    // match start of filename
                    if (!starts) continue;

                    // if path includes type, enforce match
                    if (givenType && fileType !== givenType) continue;

                    matches.push(child);
                }
            }
        }

        // resolve matches
        if (matches.length === 0) return null;
        if (matches.length > 1) {
            throw new OSError(`Ambiguous path segment '${rawPart}' (${matches.map(x => x.fullName()).join(", ")})`);
        }

        node = matches[0];
    }

    DiagnosticService.record(
        `FilesystemService_resolvePath ${path} -> ${node instanceof OSDirectory ? "directory" : "file"
        }: ${node.name}${node instanceof OSFile ? `.${node.type}` : ""}`
    );

    return node;
}

    static validationRegex = /^[a-zA-Z0-9_\-\.]+$/;

    /**
     * 
     * @param {string} name 
     * @param {string} parentPath 
     * @returns 
     */
    static createDirectory(name, parentPath) {
        if (!this.enabled) throw new OSError("FilesystemService is disabled");

        if (!this.validationRegex.test(name)) {
            throw new OSError(`Invalid directory name: "${name}". Only alphanumeric characters, underscores, hyphens, and periods are allowed.`);
        }

        const parentDir = parentPath ? this.resolvePath(parentPath) : this.currentDirectory;
        if (!parentDir || !(parentDir instanceof OSDirectory)) return null;

        if (parentDir.children.has(name)) {
            throw new OSError(`A file or directory with the name "${name}" already exists in "${parentDir.name}".`);
        }

        const dir = new OSDirectory(name, parentDir);
        parentDir.children.set(name, dir);
        DiagnosticService.record(`FilesystemService_createDirectory ${name} in ${parentDir.name}`);

        return dir;
    }

    /**
     * 
     * @param {string} identifier 
     * @param {string} parentPath 
     * @param {string[]} content 
     * @returns 
     */
    static createFile(identifier, parentPath, content = []) {
        if (!this.enabled) throw new OSError("FilesystemService is disabled");

        if(typeof identifier !== "string") throw new OSError(`File identifier must be a string, got ${typeof identifier}`);

        if(typeof parentPath !== "string") throw new OSError(`Parent path must be a string, got ${typeof parentPath}`);

        if(!Array.isArray(content)) throw new OSError(`File content must be an array of strings, got ${typeof content}`);

        // if (!this.validationRegex.test(name)) {
        //     throw new OSError(`Invalid file name: "${name}". Only alphanumeric characters, underscores, hyphens, and periods are allowed.`);
        // }

        if(identifier.split(".").length != 2){
            throw new OSError(`Invalid file identifier: "${identifier}". Must be in the format "name.type"`);
        }

        let [name, type] = identifier.split(".");

        if(!this.validationRegex.test(name) || !this.validationRegex.test(type)){
            throw new OSError(`Invalid file identifier: "${identifier}". Only alphanumeric characters, underscores, hyphens, and periods are allowed.`);
        }

        const parentDir = parentPath ? this.resolvePath(parentPath) : this.currentDirectory;
        if (!parentDir || !(parentDir instanceof OSDirectory)) return null;

        const file = new OSFile(identifier, parentDir, content);

        if (parentDir.children.has(identifier)) {
            throw new OSError(`A file "${identifier}" already exists in "${parentDir.name}".`);
        }


        parentDir.children.set(identifier, file);
        DiagnosticService.record(`FilesystemService_createFile ${identifier} -> ${parentDir.name}`);
        return file;
    }

    /**
     * 
     * @param {String} path
     * @param {"file"|"directory"|"full"|none} assumption 
     * @returns 
     */
    static setWorkingDirectory(path, assumption = "none") {
        if(!this.enabled) throw new OSError("FilesystemService is disabled");
        const dir = this.resolvePath(path, assumption);
        if (!dir || !(dir instanceof OSDirectory)) throw new OSError(`Directory not found: "${path}"`);

        this.currentDirectory = dir;
        this.workingDirectory = this.getCurrentPath();
        return true;
    }

    static getCurrentPath() {
        if(!this.enabled) return "?";
        let path = [];
        let node = this.currentDirectory;

        while (node && node.parent) {
            path.unshift(node.name);
            node = node.parent;
        }

        return "/" + path.join("/");
    }
}

class SaviorService {
    static os = null;
    static enabled = false;
    static #notified = false;

    static watch(service){
        setInterval(() => {
            if(!this.enabled) return;
            if(service.enabled == false){
                this.os.savior(`Enabled ${service.name}`);
                DiagnosticService.record(`SaviorService_save ${service.name}`);
                OutputService.clear();
                service.enable();
                this.os.commandLine();
            }
        }, 5000);
    }
    static init(os) {
        if(this.os) return;
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("SaviorService_init");

        ServiceManager.services.forEach(service => {
            if(service.critical){
                SaviorService.watch(service);
            }
        });
    }

    static enable(){
        if(this.enabled) return;
        this.enabled = true;
        DiagnosticService.record("SaviorService_enable");
    }

    static disable(){
        if(!this.enabled) return;
        this.enabled = false;
        DiagnosticService.record("SaviorService_disable");
    }

    /**
     * Notify the SaviorService that the command line will be unavailable, so it can take action to ensure the user is not left without a command line.
     * @returns 
     */
    static notify(){
        if(!this.enabled) return;
        if(this.#notified) return;
        this.#notified = true;
        DiagnosticService.record("SaviorService_notify");
    }

    static unnotify(){
        if(!this.enabled) return;
        if(this.#notified == false) return;
        this.#notified = false;
        DiagnosticService.record("SaviorService_unnotify");
    }

    static notified(){
        if(!this.enabled) return false;
        return this.#notified;
    }
}

class OutputService {
    static buffer = [];
    static os = null;
    static enabled = false;

    static enable(){
        this.enabled = true;
        DiagnosticService.record("OutputService_enable");
    }

    static disable(){
        this.enabled = false;
        DiagnosticService.record("OutputService_disable");
    }

    static init(os) {
        if(this.os) return;
        this.buffer = [];
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("OutputService_init");
    }

    static add(line) {
        if(!this.enabled) return;
        DiagnosticService.record("OutputService_add");
        this.buffer.push(line);
    }

    static flush() {
        if(!this.enabled) return;

        let lineTypes = new Set();

        for(const line of this.buffer){
            lineTypes.add(line.type);

            if(line.type === "line") this.os.line(line.content, line.loc);
            else if(line.type === "error") this.os.error(line.content);
            else if(line.type === "severe_error") this.os.severe(line.content);
            else if(line.type === "savior") this.os.savior(line.content);
            else if(line.type === "html") this.os.htmlLine(line.content, line.loc);
            else if(line.type === "pixel_matrix") {
                if(line.legacy) this.os.pixelMatrixLegacy(line.content, line.pixelSize);
                else this.os.pixelMatrix(line.content, line.pixelSize);
            } else {
                console.error(`OutputService: Unknown line type: ${line.type}`, line);
                throw new OSError(`OutputService: Unknown line type: ${line.type}`);
            }
        }
        DiagnosticService.record(`OutputService_flush ${Array.from(lineTypes).join(",")}`);
        this.buffer.length = 0;
    }

    static clear() {
        if(!this.enabled) return;
        DiagnosticService.record("OutputService_clear");
        this.buffer.length = 0;
    }

    static isEmpty() {
        if(!this.enabled) return true;
        return this.buffer.length === 0;
    }
}

class DiagnosticService {
    static enabled = false;
    static os = null;

    static diagnosticData = [];

    static enable(){
        this.enabled = true;
        DiagnosticService.record("DiagnosticService_enable");
    }

    static disable(){
        DiagnosticService.record("DiagnosticService_disable");
        this.enabled = false;
    }

    static init(os) {
        if(this.os) return;
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("DiagnosticService_init");
    }

    static record(message){
        if(!this.enabled) return;

        const stack = new Error().stack.split("\n").slice(2)
        .map(line => 
            line
            .replace(/\(https?:\/\/.*?\)/, "")
            .replace(/^\s*at\s*/, "")
            .replace(/^\s*async\s*/, "")
            .replace(/https?:\/\/.*?$/, "")
            .replace("Object.fn", "CommandExecService.execute")
            .replace(/Array\.forEach (\(<anonymous>\))?/, "")
            .replace(/new Promise (\(<anonymous>\))?/, "")
            .replace(/^OS\./, "OpSys.")
            .replace(/^new OS/, "OpSys")
            .replace("HTMLDivElement.<anonymous>", "DOM")
            .replace("HTMLDocument.<anonymous>", "DOM")
            .trim()
        ).filter(line => line.length > 0).reverse();
        // if last line is "new OS", remove it

        const replacer = ServiceManager.services.map(s => [s.name, s.abbreviation]);

        stack.forEach((line, index) => {
            replacer.forEach(([full, abbr]) => {
                line = line.replace(full, abbr);
            });
            stack[index] = line;
        });

        const msg = { 
            type: "record",
            data: {
                message,
                timestamp: Date.now(),
                stack: stack,
            }
        }

        this.diagnosticData.push(msg);
    }

    static note(message){
        if(!this.enabled) return;
        this.diagnosticData.push({
            type: "note",
            data: {
                message: message,
            }
        })
    }

    static getData(){
        return this.diagnosticData;
    }
}

class CommandExecService {
    static queue = [];
    static running = false;
    static os = null;
    static enabled = false;

    static currentAbort = null;
    static currentReject = null;

    static delay = 50;

    static enable(){
        this.enabled = true;
        DiagnosticService.record("CommandExecService_enable");
    }

    static disable(){
        this.enabled = false;
        DiagnosticService.record("CommandExecService_disable");
    }

    static interrupt(err) {
        if(!this.enabled) return;
        if (!this.os) return;

        DiagnosticService.record("CommandExecService_interrupt");
        this.queue = [];
        OutputService.buffer.length = 0;

        if (this.currentAbort) {
            this.currentAbort.abort();
        }
    }

    static postpone(){
        if(!this.enabled) return;
        CommandExecService.queue.length = 0;
        DiagnosticService.record("CommandExecService_postpone");
        SaviorService.notify();
    }

    static continue(){
        if(!this.enabled) return;
        if (!this.os) throw new OSError("CommandExecService not initialized with OS instance");

        DiagnosticService.record("CommandExecService_continue");
        this.enqueue(this.os.parseCommand("obuffer"));
        this.enqueue(this.os.parseCommand("commandline"));
        this.runNext();
        SaviorService.unnotify();
    }

    static init(os) {
        if(this.os) return;
        this.queue = [];
        this.running = false;
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("CommandExecService_init");
    }

    static enqueue(chain) {
        if(!this.enabled) return;
        if(!this.os) throw new Error("CommandExecService not initialized with OS instance");
        return new Promise((resolve, reject) => {
            DiagnosticService.record("CommandExecService_enqueue "+chain.simplify());
            this.queue.push({ chain, resolve, reject });
        });
    }

    static async runNext() {
        if(!this.enabled) return;
        if (!this.os) throw new OSError("CommandExecService not initialized with OS instance");
        if (this.running) return;
        if (this.queue.length === 0) return;

        this.running = true;

        const { chain, resolve, reject } = this.queue.shift();

        let controller = new AbortController();
        this.currentAbort = controller;
        this.currentReject = reject;

        try {
            let result = await this.os.runChain(chain, controller.signal);
            if(CommandExecService.delay > 0){
                await new Promise(r => setTimeout(r, CommandExecService.delay));
            }
            DiagnosticService.record("CommandExecService_runNext");
            resolve(result);
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") {
                OutputService.add({ type: "error", content: "Command execution interrupted." });
                OutputService.flush();
                resolve(null);
            } else if (e instanceof OSError) {
                DiagnosticService.record("CommandExecService_error executing " + chain.simplify());

                if(e.severity === 0) OutputService.add({ type: "error", content: e.message });
                else if(e.severity === 1) OutputService.add({ type: "severe_error", content: e.message });
                resolve(null);
            } else {
                DiagnosticService.record("CommandExecService_unexpectedError " + chain.simplify());
                OutputService.add({ type: "error", content: `An unexpected error occurred. Check console for details.` });
                console.error(e)
                resolve(null);
            }
        } finally {
            this.currentAbort = null;
            this.currentReject = null;
            this.running = false;
            // Only continue the queue if we weren't interrupted
            if (!controller.signal.aborted) {
                this.runNext();
            }
        }
    }
}

class BackgroundTaskService {
    static tasks = new Map();

    static taskNumber = 0;

    static init(os){
        this.os = os;
        this.enabled = true;
        DiagnosticService.record("BackgroundTaskService_init");
    }

    enable(){
        this.enabled = true;
        DiagnosticService.record("BackgroundTaskService_enable");
    }

    disable(){
        this.enabled = false;
        DiagnosticService.record("BackgroundTaskService_disable");
    }
}

class ServiceManager {
    static services = [OutputService, CommandExecService, CommandService, DiagnosticService, SaviorService, FilesystemService, ConfigService, ColorService, BackgroundTaskService];
}

ServiceManager.services.forEach(service => {
    switch(service){
        case ConfigService: {
            service.abbreviation = "Csrv";
            service.shortName = "config";
            service.critial = true;
        } break;

        case FilesystemService: {
            service.abbreviation = "Fsrv";
            service.shortName = "filesystem";
            service.critical = true;
        } break;

        case SaviorService: {
            service.abbreviation = "Ssrv";
            service.shortName = "savior";
            service.critical = true;
        } break;

        case OutputService: {
            service.abbreviation = "Osrv";
            service.shortName = "output";
            service.critical = false;
        } break;

        case DiagnosticService: {
            service.abbreviation = "Dsrv";
            service.shortName = "diagnostic";
            service.critical = false;
        } break;

        case CommandExecService: {
            service.abbreviation = "Xsrv";
            service.shortName = "commandexec";
            service.critical = true;
        } break;

        case CommandService: {
            service.abbreviation = "Esrv";
            service.shortName = "command";
            service.critical = true;
        } break;

        case ColorService: {
            service.abbreviation = "Rsrv";
            service.shortName = "color";
            service.critical = false;
        } break;

        case BackgroundTaskService: {
            service.abbreviation = "Bsrv";
            service.shortName = "background";
            service.critical = false;
        } break;
    }
});

class SwagObjectParser {
    /**
     * @param {string[]} input - Array of lines to parse
     */
    constructor(input) {
        this.lines = input.map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('//'));
        this.index = 0;
    }

    parse() {
        // top-level behaves like a block, but has no closing brace
        return this.parseBlock(true);
    }

    objectToString(obj, indent = 0) {
        let str = "";
        const indentStr = "    ".repeat(indent);
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === "object" && !Array.isArray(value)) {
                str += `${indentStr}${key} = {\n`;
                this.objectToString(value, indent + 1);
                str += `${indentStr}}\n`;
            } else {
                str += `${indentStr}${key} = ${JSON.stringify(value)}\n`;
            }
        }
    }

    parseBlock(isTopLevel = false) {
        const obj = {};

        while (this.index < this.lines.length) {
            const line = this._cleanLine(this.lines[this.index++]);
            if (!line) continue;

            if (line === "}") {
                if (isTopLevel) {
                    throw new SyntaxError("Unexpected '}' at top level");
                }
                return obj;
            }

            // nested object
            const nested = line.match(
                /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\{$/
            );

            if (nested) {
                obj[nested[1]] = this.parseBlock(false);
                continue;
            }

            // key = value
            const kv = line.match(
                /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/
            );

            if (!kv) {
                throw new OSError(`SwagObject parse error: Invalid line at ${this.index}: ${line}`);
            }

            const key = kv[1];
            const value = this.parseValue(kv[2]);

            obj[key] = value;
        }

        if (!isTopLevel) {
            throw new OSError("SwagObject parse error: Unexpected end of input (missing })");
        }

        return obj;
    }

    parseValue(raw) {
        const value = raw.trim();

        // ----- array -----
        if (value.startsWith("[") && value.endsWith("]")) {
            const inner = value.slice(1, -1).trim();

            if (inner === "") return [];

            const parts = inner.split(",").map(p => p.trim());

            return parts.map(p => {
                // strings
                if (/^(["']).*\1$/.test(p)) {
                    return p.slice(1, -1);
                }

                // numbers
                if (/^-?\d+(\.\d+)?$/.test(p)) {
                    return Number(p);
                }

                // booleans
                if (p === "true") return true;
                if (p === "false") return false;

                throw new OSError(`SwagObject parse error: Invalid array value: ${p}`);
            });
        }

        // ----- string -----
        if (/^(["']).*\1$/.test(value)) {
            return value.slice(1, -1);
        }

        // ----- number -----
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            return Number(value);
        }

        // ----- boolean -----
        if (value === "true") return true;
        if (value === "false") return false;

        throw new OSError(`SwagObject parser error: Invalid value: ${value}`);
    }

    _cleanLine(line) {
        line = line.replace(/\/\/.*$/, "");
        return line.trim();
    }
}

class OSCommandChain {
    constructor(parts){
        this.parts = parts;
    }

    addPart(part){
        this.parts.push(part);
    }

    simplify(){
        return this.parts.map(part => part.name).join("_");
    }
}

class OSError extends Error {
    constructor(message, severity = 0) {
        super(message);
        this.name = "OSError";
        this.severity = severity;
    }
}

class OSFile {
    static calculateSize(data){
        return new TextEncoder().encode(data.join("\n")).byteLength;
    }

    #content = [];
    #size = 0;

    constructor(identifier, parent, content = []) {
        let [name, type] = identifier.split(".");

        this.name = name;
        this.type = type;
        this.parent = parent; // parent directory
        this.#content = content;
        this.#size = OSFile.calculateSize(content);
    }

    fullName() {
        return `${this.name}.${this.type}`;
    }

    fullPath() {
        let path = [];
        let node = this.parent;

        while (node && node.parent) {
            path.unshift(node.name);
            node = node.parent;
        }

        return "/" + path.join("/") + "/" + this.fullName();
    }

    read(join = false) {
        if(join) return this.#content.join("\n");
        return this.#content;
    }

    /**
     * 
     * @param {String[]} newContent 
     */
    write(newContent) {
        this.#content = newContent;
        this.#size = OSFile.calculateSize(newContent);
    }

    getSize(formatted = false){

        if(formatted == false) return this.#size;

        const total = this.#size;

        function f(n){
            return Number(n.toFixed(2)).toLocaleString("en-US")
        }

        if (total < 1024) {
            // B → KB
            return `${f(total)} B`;
        }
        else if (total < 1024 * 1024) {
            const kb = total / 1024;
            return `${f(kb)} KB (${f(total)} B)`;
        }
        else if (total < 1024 * 1024 * 1024) {
            const kb = total / 1024;
            const mb = total / (1024 * 1024);
            return `${f(mb)} MB (${f(kb)} KB)`;
        }
        else {
            const mb = total / (1024 * 1024);
            const gb = total / (1024 * 1024 * 1024);
            return `${f(gb)} GB (${f(mb)} MB)`;
        }
    }
}

class OSDirectory {
    constructor(name, parent = null) {
        this.name = name;
        this.parent = parent;
        this.children = new Map(); // name -> OSFile or OSDirectory
    }

    fullPath() {
        let path = [];
        let node = this;

        while (node && node.parent) {
            path.unshift(node.name);
            node = node.parent;
        }

        return "/" + path.join("/");
    }

    list(){
        const entries = [];

        for (const [name, child] of this.children) {
            entries.push(child);
        }

        return entries;
    }
}

function defineCommands(){
    CommandService.defineCommand("service", {
        options: {
            description: "Lists all available services and their status",
        },
        schema: [
            {
                type: "positional",
                name: "action",
                description: "The action to perform",
                required: true,
                options: ["list", "enable", "disable", "logs"],
            },
            {
                type: "positional",
                name: "service",
                description: "The service to enable/disable (required for enable/disable action)",
                required: false,
            },
            {
                type: "flag",
                name: "confirm",
                description: "Some services are critical for the operation of the OS. Use this flag to confirm that you want to disable such services",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "clear",
                short: "c",
                description: "Clear the service logs.",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "trace",
                short: "t",
                description: "Trace service logs.",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "lines",
                short: "l",
                description: "Last n lines to show of the log",
                required: false,
                datatype: "number",
            }
        ]
    }, (params, os, signal) => {
        const action = params.args[0];
        if (action === "logs") {
    if (params.flags.clear) {
        DiagnosticService.diagnosticData.length = 0;
        return;
    }

    const data = DiagnosticService.getData();
    const timestampTemplate = ConfigService.get("timestamp_template");

    const output = [];

    let lastRaw = null;
    let lastStamp = null;
    let count = 0;

    const pushLast = () => {
        if (!lastRaw) return;

        let line = lastRaw;

        // apply compression suffix
        if (count > 1) {
            line += ` (x${count})`;
        }

        // extract timestamp (no regex needed)
        const endIdx = line.indexOf("]");
        let stamp = line.slice(1, endIdx);

        if (stamp === lastStamp) {
            const blank = " ".repeat(stamp.length);
            line = `[${blank}]` + line.slice(endIdx + 1);
        } else {
            lastStamp = stamp;
        }

        output.push({
            type: "line",
            content: line.slice(endIdx + 2), // skip "] "
            loc: `[${stamp}]`
        });
    };

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];

        let line;

        const time = os.timestamp(timestampTemplate, entry.data.timestamp);

        if (entry.type === "record") {
            let msg = entry.data.message;

            if (params.flags.trace) {
                const stack = entry.data.stack
                    .join(" -> ")
                    .replace(
                        "Xsrv.runNext -> OpSys.runChain -> OpSys.runSingle",
                        "Execution Pipeline"
                    );

                msg += `\n    ${stack}`;
            }

            line = `[${time}] ${msg}`;
        } else {
            line = `[${time}] [NOTE] ${entry.data.message}`;
        }

        // compression logic
        if (line === lastRaw) {
            count++;
        } else {
            pushLast();
            lastRaw = line;
            count = 1;
        }
    }

    // flush last
    pushLast();

    return params.flags.lines
        ? output.slice(-params.flags.lines)
        : output;
        } else if(action === "list"){
            const services = ServiceManager.services;
            const lines = [];

            const renderedNames = services.map(s => `${s.name}`);
            const max = renderedNames.reduce((max, name) => Math.max(max, name.length), 0);

            services.forEach((service, i) => {
                const name = renderedNames[i].padEnd(max, " ");
                lines.push({ type: "html", content: `${name} : ${service.enabled ? "<span class='enabled'>ENABLED</span>" : "<span class='disabled'>DISABLED</span>"}`, loc: "" });
            });

            return lines;

        } else if(action === "enable" || action === "disable"){
            const serviceName = params.args[1];
            if(!serviceName) return { type: "error", content: "Service name is required for enable/disable action" };

            const validServices = ServiceManager.services.map(x => x.shortName)

            if(!validServices.includes(serviceName.toLowerCase())){
                return { type: "error", content: `Unknown service: "${serviceName}". Valid services are: ${validServices.join(", ")}` };
            }

            if(action === "enable"){
                const serviceShort = params.args[1]

                for(const service of ServiceManager.services){
                    if(service.shortName === serviceShort.toLowerCase()){
                        service.enable();
                        return { type: "line", content: `Enabled ${service.name} service`, loc: "" };
                    }
                }
            } else if(action === "disable"){
                const serviceShort = params.args[1]

                for(const service of ServiceManager.services){
                    if(service.shortName === serviceShort.toLowerCase()){
                        if(service.critical && !params.flags.confirm){
                            return { type: "error", content: `The "${service.name}" service is critical for the operation of the OS. Use --confirm flag to confirm that you want to disable it.` };
                        } else {
                            service.disable();
                            return { type: "line", content: `Disabled ${service.name} service`, loc: "" };
                        }
                    }
                }
            }
        }
    });

    CommandService.defineCommand("clear", {
        options: {
            description: "Clears the output buffer and the console",
            alias: "cls"
        },
        schema: []
    }, (params, os, signal) => {
        OutputService.clear();
        os.elem.innerHTML = "";
    })

    CommandService.defineCommand("print", {
        options: {
            description: "Prints the provided arguments to the console",
        },
        schema: [
            {
                name: "text",
                description: "The text to print",
                type: "positional",
                required: true,
                pipeableFrom: "text",
            },
            {
                name: "loc_text",
                description: "The text to show in the location part of the line",
                type: "positional",
                short: "l",
                datatype: "string"
            }
        ]
    }, ({args, flags, pipe}, os, signal) => {
        const text = args[0];
        const loc = args[1] || "";

        return {
            type: "line",
            content: text,
            loc: loc
        };
    });

    // CommandService.defineCommand("formattedprint", {

    // })

    CommandService.defineCommand("obuffer", {
        options: {
            description: "Outputs the current output buffer",
            hidden: true
        },
        schema: []
    }, (params, os, signal) => {
        OutputService.flush();
    });

    CommandService.defineCommand("commandline", {
        options: {
            description: "Outputs a new command line for input",
            hidden: true
        },
        schema: []
    }, (params, os, signal) => {
        if(!os.commandRunning) os.commandLine();
    });

    CommandService.defineCommand("linecount", {
        options: {
            description: "Outputs the number of lines",
            alias: "lc"
        },
        schema: []
    }, (params, os, signal) => {
        if(params.pipe) return {
            type: "line",
            content: params.pipe.length,
            loc: ""
        }
        else return {
            type: "line",
            content: Array.from(os.elem.children).filter(child => child.classList.contains('line')).length - 1,
            loc: ""
        }
    });

    CommandService.defineCommand("help", {
        options: {
            description: "Lists all available commands. To get help with a specific command, use \"help commandname\"",
            alias: "?"
        },
        schema: [
            {
                type: "flag",
                name: "aliases",
                short: "a",
                description: "Show command aliases in list",
                datatype: "boolean",
            },
            {
                type: "positional",
                name: "command",
                description: "The command to get help for",
                required: false,
            },
            {
                type: "flag",
                name: "verbose",
                short: "v",
                description: "Show detailed help information for each command",
                datatype: "boolean",
            }
        ]
    }, ({flags, args}, os, signal) => {
        const commandName = args[0];

        if (commandName) {

            const entry = CommandService.getCommand(commandName);
            if (!entry) throw new OSError(`Unknown command: "${commandName}"`);

            let name = entry.body.aliasOf ?? commandName;

            const schema = entry.body.schema || [];
            const positionalArgs = schema.filter(s => s.type === "positional");
            const flagArgs = schema.filter(s => s.type === "flag" || s.type === "option");

            if (flags.verbose) {

                let usage = `Usage: ${name}`;
                let descriptions = [];

                for (const param of positionalArgs) {
                    usage += param.required
                        ? ` <${param.name}>`
                        : ` [${param.name}]`;
                }

                if (entry.body.aliasOf) {
                    descriptions.push({ type: "line", content: `Alias of: ${entry.body.aliasOf}`, loc: "" });
                } else if (entry.body.options.alias) {
                    descriptions.push({ type: "line", content: `Alias: ${entry.body.options.alias}`, loc: "" });
                }

                for (const param of flagArgs) {
                    let flagPart = '';

                    if (param.short) flagPart += `-${param.short}`;
                    if (param.short && param.name) flagPart += "|";
                    if (param.name) flagPart += `--${param.name}`;

                    usage += param.required
                        ? ` ${flagPart}=<${param.datatype}>`
                        : ` [${flagPart}=<${param.datatype}>]`;
                }

                descriptions.push({ type: "line", content: "", loc: "" });

                for (const param of positionalArgs) {
                    descriptions.push({ type: "line", content: `${param.name}: ${param.description || "No description available"}`, loc: "" });
                    descriptions.push({ type: "line", content: `    Type: positional`, loc: "" });
                    descriptions.push({ type: "line", content: `    Required: ${param.required ? "Yes" : "No"}`, loc: "" });

                    if (param.options) {
                        descriptions.push({ type: "line", content: `    Options: ${param.options.join(", ")}`, loc: "" });
                    }

                    descriptions.push({ type: "line", content: "", loc: "" });
                }

                for (const param of flagArgs) {
                    let flagPart = '';

                    if (param.short) flagPart += `-${param.short}`;
                    if (param.short && param.name) flagPart += "|";
                    if (param.name) flagPart += `--${param.name}`;

                    descriptions.push({ type: "line", content: `${flagPart}: ${param.description || "No description available"}`, loc: "" });
                    descriptions.push({ type: "line", content: `    Type: ${param.type}`, loc: "" });
                    descriptions.push({ type: "line", content: `    Datatype: ${param.datatype}`, loc: "" });
                    descriptions.push({ type: "line", content: `    Required: ${param.required ? "Yes" : "No"}`, loc: "" });
                    descriptions.push({ type: "line", content: "", loc: "" });
                }

                return [
                    { type: "line", content: usage, loc: "" },
                    { type: "line", content: entry.body.options.description || "No description available", loc: "" },
                    ...descriptions
                ];

            } else {

                let usage = `Usage: ${name}`;

                for (const param of positionalArgs) {
                    usage += param.required
                        ? ` <${param.name}>`
                        : ` [${param.name}]`;
                }

                for (const param of flagArgs) {
                    const flagPart = param.short ? `-${param.short}` : `--${param.name}`;
                    usage += param.required
                        ? ` ${flagPart}`
                        : ` [${flagPart}]`;
                }

                return [
                    { type: "line", content: usage, loc: "" },
                    { type: "line", content: entry.body.options.description || "No description available", loc: "" }
                ];
            }
        }

        const entries = [];

        // flatten once and resolve once
        for (const nameSet of CommandService.registeredCommands) {
            for (const name of nameSet) {

                const entry = CommandService.getCommand(name);
                if (!entry) continue;

                entries.push({ name, entry });
            }
        }

        const commands = entries
            .filter(({ entry }) => !entry.body.aliasOf)
            .filter(({ entry }) => !entry.body.options.hidden)
            .map(({ name }) => {

                if (flags.aliases) {
                    const aliases = [];

                    for (const [n, e] of CommandService.commands) {
                        if (e.body.aliasOf === name) aliases.push(n);
                    }

                    if (aliases.length) {
                        return `${name} (${aliases.join(", ")})`;
                    }
                }

                return name;
            })
            .sort((a, b) => a.localeCompare(b));

        return [
            { type: "line", content: "Available commands:", loc: "" },
            { type: "line", content: commands.join(", "), loc: "" }
        ];
    });

    CommandService.defineCommand("findtext", {
        options: {
            description: "Find text",
            alias: "find"
        },
        schema: [
            {
                type: "positional",
                name: "text",
                description: "The text to find",
                required: true,
                pipeableFrom: "text",
            },
            {
                type: "flag",
                name: "ignorecase",
                short: "i",
                description: "Ignore case when searching",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "regex",
                short: "r",
                description: "Treat the search text as a regular expression",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "search_loc",
                short: "l",
                description: "Search in the location part of the line as well",
                required: false,
                datatype: "boolean",
            }
        ]
    }, ({args, pipe, flags}, os, signal) => {
        let input = null;

        if(pipe) input = pipe;
        else {
            input = [];
            const lines = Array.from(os.elem.querySelectorAll(".line")).map(x => Array.from(x.children));
            lines.forEach((line, i) => {
                input.push({
                    type: "line",
                    content: line[1].textContent,
                    loc: line[0].textContent
                })
            })
        }

        const searchText = args[0];
        const ignoreCase = flags.ignorecase || false;
        const isRegex = flags.regex || false;

        let regex;

        if (isRegex) {
            try {
                regex = new RegExp(searchText, ignoreCase ? "gi" : "g");
            } catch (e) {
                return { type: "error", content: `Invalid regular expression: ${e.message}` };
            }
        } else {
            const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            regex = new RegExp(escaped, ignoreCase ? "gi" : "g");
        }

        const result = [];

        for (let line of input) {
            const text = line.content;

            let matches = [...text.matchAll(regex)];
            if (matches.length === 0) continue;

            let out = "";
            let last = 0;

            for (let m of matches) {
                const start = m.index;
                const end = start + m[0].length;

                out += text.slice(last, start);
                out += `<span class="highlight">${m[0]}</span>`;

                last = end;
            }

            out += text.slice(last);

            result.push({
                type: "html",
                content: out,
                loc: ""
            });
        }

        if(result.length === 0){
            return { type: "error", content: "No matches found", loc: "" };
        }

        return result;
    });

    CommandService.defineCommand("makefile", {
        options: {
            description: "Creates a file",
            alias: "mf",
            example: [
                "makefile myfile.txt",
                "makefile path/myfile.txt",
            ]
        },
        schema: [
            {
                type: "positional",
                name: "path",
                description: "The name of the file to create in [name].[filetype] format",
                required: true,
            }
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        if(!path) return { type: "error", content: "File identifier is required", loc: "" };

        const parts = path.split("/");

        let lastPart = parts.pop();

        let [name, type] = lastPart.split(".");

        if(!type) type = "txt";

        try {
            FilesystemService.createFile(name, type, parts.join("/"), [""]);
            return { type: "line", content: `Created file "${name}.${type}"`, loc: "" };
        } catch (e) {
            return { type: "error", content: e.message, loc: "" };
        }   
    })

    CommandService.defineCommand("makedirectory", {
        options: {
            description: "Creates a directory",
            alias: "md",
            example: [
                "makedirectory mydir",
                "makedirectory /path/mydir"
            ]
        },
        schema: [
            {
                type: "positional",
                name: "directory_name",
                description: "The name of the directory to create",
                required: true,
            },
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        const parts = path.split("/");

        const dirName = parts.pop();

        if(!dirName) return { type: "error", content: "Directory name is required", loc: "" };

        try {
            FilesystemService.createDirectory(dirName, parts.join("/"));
            return { type: "line", content: `Created directory "${dirName}"`, loc: "" };
        } catch (e) {
            return { type: "error", content: e.message, loc: "" };
        }
    })

    CommandService.defineCommand("changedirectory", {
        options: {
            description: "Changes the current working directory",
            alias: "cd",
            example: [
                "changedirectory",
                "changedirectory /path/to/directory",
                "changedirectory ..",
                "changedirectory ../.."
            ]
        },
        schema: [
            {
                type: "positional",
                name: "path",
                description: "The path of the directory to change to.",
                required: true,
            },
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        try {
            FilesystemService.setWorkingDirectory(path, "full");
            return;
        } catch (e) {
            return { type: "error", content: e.message, loc: "" };
        }
    })

    CommandService.defineCommand("list", {
        options: {
            description: "Lists files in the current working directory",
            alias: "ls"
        },
        schema: [
            {
                type: "flag",
                name: "recursive",
                short: "r",
                description: "List files recursively",
                required: false,
                datatype: "number",
                default: 0
            },
            {
                type: "flag",
                name: "size",
                short: "s",
                description: "Show file sizes",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "spacing",
                short: "sp",
                description: "Set the spacing between tree branches when using recursive listing",
                required: false,
                datatype: "number",
            }
        ],
    }, ({args, flags}, os, signal) => {
        if(flags.recursive != undefined){
            const recurseAmount = flags.recursive > 0 ? flags.recursive : Infinity;

            const dir = FilesystemService.resolvePath(FilesystemService.getCurrentPath());

            const lines = [];

            if(flags.spacing && flags.spacing < 1) throw new OSError("Spacing must be at least 1");

            const spacing = flags.spacing ?? ConfigService.get("default_list_recursive_spacing");

            const listRecursive = (directory, prefix = "", level = 0) => {
                if (level >= recurseAmount) return;

                const entries = directory.list();

                const lastIndex = entries.length - 1;

                entries.forEach((entry, index) => {
                    const isLast = index === lastIndex;

                    // Tree characters
                    const branch = (isLast ? "└" : "├") + "─".repeat(spacing - 1);
                    const nextPrefix = prefix + (isLast ? (" " + " ".repeat(spacing)) : ("│" + ' '.repeat(spacing)));

                    if (entry instanceof OSDirectory) {
                        lines.push({ type: "line", content: entry.name, loc: prefix + branch });
                        listRecursive(entry, nextPrefix, level + 1);
                    } else {
                        let line = entry.fullName();
                        if(flags.size) line += ` - ${entry.getSize(true)}`;
                        lines.push({ type: "line", content: line, loc: prefix + branch })
                    }
                });
            };

            listRecursive(dir);

            return lines;
        }

        const children = FilesystemService.resolvePath(FilesystemService.getCurrentPath()).children;
        const lines = [];

        children.entries().forEach(([name, child]) => {
            if (child instanceof OSDirectory){
                lines.push({ type: "line", content: ` [DIR] ${child.name}`, loc: "" });
            }
        })
        children.entries().forEach(([name, child]) => {
            if(child instanceof OSFile){
                let line = `       ${child.fullName()}`;
                if(flags.size) line += ` (${child.getSize(true)})`;
                lines.push({ type: "line", content: line, loc: "" });
            }
        })

        if(lines.length == 0){
            lines.push({ type: "line", content: "-- Directory empty --", loc: "" });
        }
        
        return lines;
    })

    CommandService.defineCommand("peek", {
        options: {
            description: "Read a file",
            alias: "p"
        },
        schema: [
            {
                type: "positional",
                name: "file_path",
                description: "The path of the file to read",
                required: true,
            },
            {
                type: "flag",
                name: "raw",
                short: "r",
                description: "Outputs raw file content",
                required: false,
                datatype: "boolean",
            },
        ]
    }, ({args, pipe, flags}, os, signal) => {
        const path = args[0];

        const file = FilesystemService.resolvePath(path, "full");
        if(!(file instanceof OSFile)) throw new OSError(`file "${path}" could not be found`);

        function outputRaw(file) {
            const lines = [{ type: "line", content: `--- ${flags.raw ? "Raw " : ""}Contents of "${file.fullName()}" ---`, loc: "" }];
            file.read().forEach(line => {
                lines.push({ type: "line", content: line, loc: ":" });
            });
            return lines;
        }

        try {
            if(flags.raw) return outputRaw(file);
            
            return outputRaw(file);
        } catch(e) {
            console.log(e);
            if(e instanceof OSError) return { type: "error", content: e.message, loc: "" };
            else {
                console.error(e);
                return { type: "error", content: `An unexpected error occurred while reading the file. Check console for details.`, loc: "" };
            }
        }
    });

    CommandService.defineCommand("view", {
        options: {
            description: "View an image file",
            alias: "v"
        },
        schema: [
            {
                type: "positional",
                name: "file_path",
                description: "The path of the file to read",
                required: true,
            },
            {
                type: "flag",
                name: "legacy",
                short: "l",
                description: "Use legacy rendering for images. Slower, but can support larger pixel sizes.",
                required: false,
                datatype: "boolean",
            },
            {
                type: "flag",
                name: "pixelsize",
                short: "p",
                description: "Set the pixel size",
                required: false,
                datatype: "number",
                default: 1
            },
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        const file = FilesystemService.resolvePath(path, "full");
        if(!(file instanceof OSFile)) throw new OSError(`file "${path}" could not be found`);
        const fileData = file.read();

        if(["bmap", "img"].includes(file.type)){

            let imageData = [];

            if(file.type === "img"){
                imageData = ImageReader.decodeImage(file.read());
            } else if(file.type === "bmap"){

                let width = parseInt(fileData[1]);
                let height = parseInt(fileData[2]);
                let data = fileData.slice(3).map(x => x.split(" ").map(x => "#"+x))

                if(data.length !== height) throw new OSError(`Invalid bmap file: height does not match data length`);
                if(data[0].length !== width) throw new OSError(`Invalid bmap file: width does not match data width`);
                if(data.some(row => row.length !== width)) throw new OSError(`Invalid bmap file: width does not match data width`);

                imageData = data;
            }

            return [{ type: "pixel_matrix", content: imageData, legacy: flags.legacy, pixelSize: flags.pixelsize }];
        } else {
            return { type: "error", content: `Unsupported file type: "${file.type}".`, loc: "" };
        }
    })

    CommandService.defineCommand("time", {
        options: {
            description: "Outputs the current timestamp",
            alias: "time",
        },
        schema: [
            {
                type: "positional",
                name: "template",
                description: "The template to use for the timestamp. If not provided, the default template from the config will be used.",
                required: false,
            },
        ]
    }, ({args, flags}, os, signal) => {
        const template = args[0] || ConfigService.get("timestamp_template");
        return { type: "line", content: os.timestamp(template), loc: "" };
    })

    CommandService.defineCommand("colortest", {
        options: {
            description: "Outputs a test of all colors in the palette",
            hidden: true
        },
        schema: [],
    }, ({args, flags}, os, signal) => {
        const paletteKey = ConfigService.get("color_palette");

        const palette = FilesystemService.resolvePath(`/data/palettes/${paletteKey}.conf`, "full");

        if(!palette) throw new OSError(`Palette file not found at /data/palettes/${paletteKey}.conf`);
        if(!(palette instanceof OSFile)) throw new OSError(`Palette file not found at /config/palette.conf`);

        const htmlLines = [];

        const paletteFile = new SwagObjectParser(palette.read()).parse();

        function getContrastingColor(hex) {
            hex = hex.replace("#", "");

            let r = parseInt(hex.substring(0, 2), 16) / 255;
            let g = parseInt(hex.substring(2, 4), 16) / 255;
            let b = parseInt(hex.substring(4, 6), 16) / 255;

            [r, g, b] = [r, g, b].map(c =>
                c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
            );

            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

            return luminance > 0.179 ? "#000000" : "#ffffff";
        }

        const pad = Math.max(...Object.entries(paletteFile).map(x=>x[1].length));

        const pairs = {};

        let padding = '';
        
        for(const [key, value] of Object.entries(paletteFile)){

            const [category, type] = key.split("_");

            if(pairs[category] == undefined) pairs[category] = {};

            padding = " ".repeat(pad - value.length + 10);

            if(type === "background") {
                pairs[category].background = value;
                htmlLines.push({type: "html", content: `${value.padStart(pad, " ")} : <span style="color: ${getContrastingColor(value)}; background-color: ${value}">${key}</span>`})
            } else if(type === "color") {
                pairs[category].color = value;
                htmlLines.push({type: "html", content: `${value.padStart(pad, " ")} : <span style="color: ${value}; background-color: ${getContrastingColor(value)}">${key}</span>`})
            }
        }

        htmlLines.push({type: "html", content: `<br>`})


        for(const [category, pair] of Object.entries(pairs)){
            if(pair.background && pair.color){
                htmlLines.push({type: "html", loc: padding,  content: `<span style="color: ${pair.color}; background-color: ${pair.background}">${category}</span>`})
            }
        }

        return htmlLines;
    });

    CommandService.defineCommand("fileinfo", {
        options: {
            description: "Outputs information about a file",
            alias: "fi",
        },
        schema: [
            {
                type: "positional",
                name: "file_path",
                description: "The path of the file to get information about",
                required: true,
                assumption: "full"
            },
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        const file = FilesystemService.resolvePath(path, "full");

        if(!(file instanceof OSFile)) return { type: "error", content: `"${path}" is not a file`, loc: "" };

        return [
            { type: "line", content: `File name : ${file.name}`, loc: "" },
            { type: "line", content: `File type : ${file.type}`, loc: "" },
            { type: "line", content: `     Size : ${file.getSize(true)}`, loc: "" },
        ]
    })

    CommandService.defineCommand("remove", {
        options: {
            description: "Removes a file or directory",
            alias: "rm",
        },
        schema: [
            {
                type: "positional",
                name: "path",
                description: "The path of the file or directory to remove",
                required: true,
            }
        ],
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        try {
            const name = FilesystemService.remove(path);
            return { type: "line", content: `Removed ${name}`, loc: "" };
        } catch (e) {
            if(e instanceof OSError) return { type: "error", content: e.message, loc: "" };
            else {
                console.error(e);
                return { type: "error", content: `An unexpected error occurred. Check console for details.`, loc: "" };
            }
        }
    });

    CommandService.defineCommand("config", {
        options: {
            description: "Gets or sets configuration values",
            alias: "cfg",
        },
        schema: [
            {
                type: "positional",
                name: "action",
                description: "The action to perform",
                required: true,
                options: ["list", "reload"],
            },
        ],
    }, ({args, flags}, os, signal) => {
        const action = args[0];

        if(action === "list"){
            const config = ConfigService.getAll();
            const lines = [];

            const maxKeyLength = Math.max(...Object.keys(config).map(k => k.length));

            for(const [key, value] of Object.entries(config)){
                lines.push({ type: "line", content: `${key.padEnd(maxKeyLength, " ")} : ${value}`, loc: "" });
            }
            
            return lines;
        }

        if(action === "reload"){
            ConfigService.reload();
            return { type: "line", content: "Configuration reloaded", loc: "" };
        }
    });

    CommandService.defineCommand("editfile", {
        options: {
            description: "Opens a file in the editor",
            alias: "ef",
        },
        schema: [
            {
                type: "positional",
                name: "file_path",
                description: "The path of the file to edit",
                required: true,
            }
        ]
    }, ({args, flags}, os, signal) => {
        const path = args[0];

        // if in a stream, use the stream content as what to edit

        try {
            const file = FilesystemService.resolvePath(path, "full");
            if(!(file instanceof OSFile)) throw new OSError(`"${path}" is not a file`);


            CommandExecService.postpone();
            os.openEditor(file);
        } catch (e) {
            if(e instanceof OSError) return { type: "error", content: e.message, loc: "" };
            else { 
                console.error(e);
                return { type: "error", content: `An unexpected error occurred. Check console for details.`, loc: "" };
            }
        }
    })

    CommandService.defineCommand("bgtask", {
        options: {
            description: "Runs a command in the background and outputs its result when it's done",
            alias: "bgt",
            hidden: true,
        },
        schema: [
            {
                type: "positional",
                name: "option",
                description: "The command to run in the background",
                required: true,
                options: ["start", "stop"],
            },
        ],
    }, ({args, flags}, os, signal) => {
        const option = args[0];
    });

    CommandService.bulkRegister(["print", "obuffer", "commandline", "linecount", "help", "clear", "service", "findtext", "makefile", "makedirectory", "list", "changedirectory", "peek", "time", "colortest", "fileinfo", "remove", "config", "editfile", "bgtask", "view"]);
}

function normalizeIndentation(string, indentSize = 4){
    return string.split("\n").filter(line => line.trim() !== "").map(line => {
            return line.replace(new RegExp(`^\\s{${indentSize}}`), "")
        }).join("\n")
}

function createFilesystem(){
    DiagnosticService.note("Creating filesystem...");
    DiagnosticService.disable();
    FilesystemService.createDirectory("documents", "/")
    FilesystemService.createDirectory("images", "/documents")
    FilesystemService.createDirectory("test", "/documents/images")
    FilesystemService.createDirectory("config", "/")
    FilesystemService.createDirectory("data", "/")

    FilesystemService.createFile("welcome.txt", "/", [
        "Hello there!",
        "This is a test file.",
    ])

    FilesystemService.createDirectory("palettes", "/data")

    FilesystemService.createFile("user.conf", "/config",
        normalizeIndentation(
            `
            timestamp_template = "d/mn/Y h:m:s.l"
            color_palette = "default"
            default_list_recursive_spacing = 2
            pixel_size = 1
            `, 12
        ).split("\n")
    );

    FilesystemService.createFile("editor_styling.conf", "/data",
        normalizeIndentation(
            `
            txt = {
                loc = ":"
                current_line_indicator = ">"
            }
            conf = {
                loc = " $lineno"
                current_line_indicator = ">$lineno"
            }
            `, 12
        ).split("\n")
    );

    FilesystemService.createFile("filetypes.txt", "/documents", [
        "txt - Plain text file",
        "conf - json-like config file",
        "bmap - straight bitmap. starts with a header, width, height, followed by each row of pixels, where each value corresponds to a hex color",
        "img - compressed image"
    ]);

    // 330x400
    FilesystemService.createFile("stabby.bmap", "/documents/images/test", IMAGES.stabby);

    FilesystemService.createFile("stabby.img", "/documents/images/test", IMAGES.stabbyimg)

    // 312x438
    FilesystemService.createFile("pillar.img", "/documents/images/test", IMAGES.pillar)

    // FilesystemService.createFile("guy.ici", "/documents/images/test", ["ici","40","24","16","000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF","800000","008000","000080","808000","800080","008080","C0C0C0","808080","7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 3 3 3 3 3 3 3 3 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 3 3 3 3 3 3 3 3 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 3 3 3 3 3 2 2 3 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 3 3 3 3 3 3 3 2 2 3 3 3 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 3 3 3 3 2 2 3 3 3 3 3 3 7 7 7 7 7 7 7 0 7 7 0 0 0 7 7 7 7 0 0 0 7 7 7 7 0 7 7 7 3 3 3 3 2 2 3 3 3 3 3 3 7 7 7 7 7 7 7 0 7 0 0 7 0 7 7 7 0 7 7 7 0 7 7 7 0 7 7 7 3 3 3 3 3 3 3 3 3 3 3 3 7 7 7 7 7 7 7 0 0 0 7 7 0 7 7 7 0 7 7 7 0 7 7 7 0 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 0 0 7 7 7 0 0 7 7 0 7 7 7 0 7 7 0 0 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 0 7 7 0 0 0 7 7 7 0 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 0 7 0 7 7 7 7 0 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 0 0 0 0 0 0 0 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 0 7 7 7 7 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 0 7 7 7 7 7 7 7 7 7 7 7 7 7 8 8 8 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 0 7 7 7 7 7 7 9 9 9 9 9 9 9 9 8 8 8 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 0 9 9 9 9 9 9 9 9 9 9 9 9 9 9 8 8 8 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 0 9 0 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 0 9 9 9 0 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 0 9 9 9 0 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9"]);

    FilesystemService.createFile("default.conf", "/data/palettes", 
        normalizeIndentation(
            `
            palette = {
                black = "#000000"
                white = "#FFFFFF"
                red = "#FF0000"
                lime = "#00FF00"
                blue = "#0000FF"
                yellow = "#FFFF00"
                cyan = "#00FFFF"
                magenta = "#FF00FF"
                silver = "#C0C0C0"
                gray = "#808080"
                dark_gray = "#5a5a5a"
                dark_red = "#8B0000"
                orange = "#FFA500"
                green = "#008000"
                purple = "#800080"
                teal = "#008080"
                navy = "#000080"
                lime2 = "#90ee90"
                red2 = "#ff5e5e"
                light_purple = "#d862ff"
                
            }

            definitions = {
                terminal_background = "black"

                loc_background = "black"
                loc_color = "white"

                line_background = "black"
                line_color = "white"

                error_background = "red"
                error_color = "white"

                severeError_background = "dark_red"
                severeError_color = "white"

                savior_background = "dark_gray"
                savior_color = "white"

                enabled_background = "transparent"
                enabled_color = "lime2"

                disabled_background = "transparent"
                disabled_color = "red2"

                highlight_background = "light_purple"
                highlight_color = "white"

                editor_background = "black"
                editor_color = "white"

                editor_loc_background = "black"
                editor_loc_color = "white"
            }
            `, 12
    ).split("\n"))


    // https://lospec.com/palette-list/endesga-64
    // FilesystemService.createFile("vibrant.conf", "/data/palettes", 
    // normalizeIndentation(
    //     `
    //     palette = {
    //         black = "#000000"
    //         black2 = "#131313"
    //         darkgrey1 = "#1b1b1b"
    //         darkgrey2 = "#272727"
    //         grey = "#3d3d3d"
    //         lightgrey1 = "#5d5d5d"
    //         lightgrey2 = "#858585"
    //         silver = "#b4b4b4"
    //         white = "#ffffff"
    //         bluegrey1 = "#c7cfdd"
    //         bluegrey2 = "#92a1b9"
    //         bluesteel = "#657392"
    //         slate1 = "#424c6e"
    //         navy1 = "#2a2f4e"
    //         navy2 = "#1a1932"
    //         navy3 = "#0e071b"
    //         deepnavy = "#1c121c"
    //         brown1 = "#391f21"
    //         brown2 = "#5d2c28"
    //         brown3 = "#8a4836"
    //         brown4 = "#bf6f4a"
    //         lightbrown1 = "#e69c69"
    //         lightbrown2 = "#f6ca9f"
    //         tan = "#f9e6cf"
    //         gold = "#edab50"
    //         orange1 = "#e07438"
    //         redorange = "#c64524"
    //         deepred = "#8e251d"
    //         darkorange = "#ff5000"
    //         orange2 = "#ed7614"
    //         orangeyellow = "#ffa214"
    //         yellow = "#ffc825"
    //         paleyellow = "#ffeb57"
    //         palegreen = "#d3fc7e"
    //         green1 = "#99e65f"
    //         green2 = "#5ac54f"
    //         green3 = "#33984b"
    //         darkgreen = "#1e6f50"
    //         teal = "#134c4c"
    //         darkblue1 = "#0c2e44"
    //         darkblue2 = "#00396d"
    //         blue = "#0069aa"
    //         lightblue1 = "#0098dc"
    //         lightblue2 = "#00cdf9"
    //         lightblue3 = "#0cf1ff"
    //         skyblue1 = "#4dc0d1"
    //         skyblue2 = "#93e5ec"
    //         skyblue3 = "#69cee4"
    //         cyan = "#94fdff"
    //         lightpink = "#fdd2ed"
    //         pink1 = "#f389f5"
    //         pink2 = "#db3ffd"
    //         purple = "#7a09fa"
    //         deepblue = "#3003d9"
    //         darkblue3 = "#0c0293"
    //         darkblue4 = "#03193f"
    //         darkpurple1 = "#3b1443"
    //         darkpurple2 = "#622461"
    //         magenta1 = "#93388f"
    //         magenta2 = "#ca52c9"
    //         rose1 = "#c85086"
    //         rose2 = "#f68187"
    //         rose3 = "#f5555d"
    //         red = "#ff0040"
    //         red1 = "#ea323c"
    //         red2 = "#c42430"
    //         red3 = "#891e2b"
    //         darkred = "#571c27"
    //     }

    //     definitions = {
    //         terminal_background = "black"

    //         loc_background = "black"
    //         loc_color = "white"

    //         line_background = "black"
    //         line_color = "white"

    //         error_background = "rose3"
    //         error_color = "white"

    //         severeError_background = "darkred"
    //         severeError_color = "white"

    //         savior_background = "grey"
    //         savior_color = "white"

    //         enabled_background = "transparent"
    //         enabled_color = "green2"

    //         disabled_background = "transparent"
    //         disabled_color = "red2"

    //         highlight_background = "magenta2"
    //         highlight_color = "white"

    //         editor_background = "black"
    //         editor_color = "white"

    //         editor_loc_background = "black"
    //         editor_loc_color = "white"
    //     }
    //     `, 12
    // ).split("\n"))

    // FilesystemService.createFile("676_rgb.conf", "/data/palettes", 
    // normalizeIndentation(
    //     `
    //     palette = {
    //         black = "#000000"
    //         deep_navy_blue = "#000033"
    //         navy_blue = "#000066"
    //         royal_blue_dark = "#000099"
    //         royal_blue = "#0000cc"
    //         pure_blue = "#0000ff"

    //         very_dark_forest_green = "#002a00"
    //         very_dark_teal = "#002a33"
    //         deep_blue_teal = "#002a66"
    //         deep_blue = "#002a99"
    //         strong_blue = "#002acc"
    //         bright_blue = "#002aff"

    //         dark_forest_green = "#005500"
    //         dark_olive_teal = "#005533"
    //         dark_teal = "#005566"
    //         steel_blue_dark = "#005599"
    //         steel_blue = "#0055cc"
    //         bright_steel_blue = "#0055ff"

    //         green = "#008000"
    //         green_teal = "#008033"
    //         teal_green = "#008066"
    //         teal = "#008099"
    //         cyan_teal = "#0080cc"
    //         cyan = "#0080ff"

    //         bright_green = "#00aa00"
    //         bright_lime_green = "#00aa33"
    //         neon_green = "#00aa66"
    //         mint_green = "#00aa99"
    //         aqua_green = "#00aacc"
    //         aqua = "#00aaff"

    //         neon_green_bright = "#00d400"
    //         vivid_lime_green = "#00d433"
    //         neon_lime = "#00d466"
    //         bright_mint = "#00d499"
    //         bright_aqua = "#00d4cc"
    //         cyan_bright = "#00d4ff"

    //         pure_green = "#00ff00"
    //         neon_lime_2 = "#00ff33"
    //         lime_green = "#00ff66"
    //         mint = "#00ff99"
    //         mint_aqua = "#00ffcc"
    //         aqua_2 = "#00ffff"

    //         very_dark_red = "#330000"
    //         very_dark_magenta = "#330033"
    //         dark_purple = "#330066"
    //         deep_purple = "#330099"
    //         blue_purple = "#3300cc"
    //         blue_violet = "#3300ff"

    //         dark_olive = "#332a00"
    //         dark_warm_gray = "#332a33"
    //         dark_slate_blue = "#332a66"
    //         slate_blue = "#332a99"
    //         blue_slate = "#332acc"
    //         blue = "#332aff"

    //         olive_green_dark = "#335500"
    //         muted_green = "#335533"
    //         dark_teal_gray = "#335566"
    //         steel_blue_dim = "#335599"
    //         steel_blue_2 = "#3355cc"
    //         bright_blue = "#3355ff"

    //         green_dim = "#338000"
    //         green_teal_dim = "#338033"
    //         teal_green_dim = "#338066"
    //         cyan_teal_dim = "#338099"
    //         cyan = "#3380cc"
    //         bright_cyan = "#3380ff"

    //         green_bright = "#33aa00"
    //         lime_green = "#33aa33"
    //         bright_green_2 = "#33aa66"
    //         mint_green_2 = "#33aa99"
    //         aqua_green_2 = "#33aacc"
    //         cyan_bright_2 = "#33aaff"

    //         neon_green_2 = "#33d400"
    //         neon_lime = "#33d433"
    //         lime_bright = "#33d466"
    //         mint_bright = "#33d499"
    //         aqua_bright = "#33d4cc"
    //         cyan_bright_3 = "#33d4ff"

    //         neon_lime_bright = "#33ff00"
    //         lime_bright_2 = "#33ff33"
    //         bright_lime = "#33ff66"
    //         mint_bright_2 = "#33ff99"
    //         aqua_mint = "#33ffcc"
    //         aqua_bright_2 = "#33ffff"

    //         dark_red = "#660000"
    //         dark_crimson = "#660033"
    //         dark_purple_red = "#660066"
    //         purple = "#660099"
    //         blue_purple_2 = "#6600cc"
    //         vivid_blue = "#6600ff"

    //         dark_brown_orange = "#662a00"
    //         dark_warm_gray_2 = "#662a33"
    //         muted_purple = "#662a66"
    //         slate_purple = "#662a99"
    //         slate_blue_2 = "#662acc"
    //         blue_2 = "#662aff"

    //         olive_brown = "#665500"
    //         olive_green = "#665533"
    //         muted_teal = "#665566"
    //         steel_blue_3 = "#665599"
    //         steel_blue_4 = "#6655cc"
    //         bright_blue_2 = "#6655ff"

    //         olive_green_2 = "#668000"
    //         olive_teal = "#668033"
    //         muted_green_2 = "#668066"
    //         cyan_green_dim = "#668099"
    //         cyan_2 = "#6680cc"
    //         cyan_bright_2 = "#6680ff"

    //         green_bright_2 = "#66aa00"
    //         lime_green_2 = "#66aa33"
    //         mint_green_3 = "#66aa66"
    //         mint = "#66aa99"
    //         aqua_3 = "#66aacc"
    //         cyan_3 = "#66aaff"

    //         neon_green_3 = "#66d400"
    //         neon_lime_2 = "#66d433"
    //         lime_bright_3 = "#66d466"
    //         mint_bright_3 = "#66d499"
    //         aqua_bright_3 = "#66d4cc"
    //         cyan_bright_4 = "#66d4ff"

    //         neon_lime_3 = "#66ff00"
    //         lime_2 = "#66ff33"
    //         bright_lime_2 = "#66ff66"
    //         mint_2 = "#66ff99"
    //         aqua_mint_2 = "#66ffcc"
    //         aqua_4 = "#66ffff"

    //         dark_red_2 = "#990000"
    //         crimson = "#990033"
    //         deep_magenta = "#990066"
    //         purple_2 = "#990099"
    //         bright_purple = "#9900cc"
    //         violet = "#9900ff"

    //         dark_orange_brown = "#992a00"
    //         warm_gray = "#992a33"
    //         muted_plum = "#992a66"
    //         dusty_purple = "#992a99"
    //         lavender = "#992acc"
    //         blue_purple_3 = "#992aff"

    //         olive_brown_2 = "#995500"
    //         olive = "#995533"
    //         muted_green_3 = "#995566"
    //         steel_gray = "#995599"
    //         steel_blue_5 = "#9955cc"
    //         bright_blue_3 = "#9955ff"

    //         olive_2 = "#998000"
    //         olive_green_3 = "#998033"
    //         muted_olive = "#998066"
    //         cyan_green_dim_2 = "#998099"
    //         cyan_4 = "#9980cc"
    //         cyan_bright_3 = "#9980ff"

    //         yellow_green = "#99aa00"
    //         lime_olive = "#99aa33"
    //         mint_green_4 = "#99aa66"
    //         mint_gray = "#99aa99"
    //         aqua_5 = "#99aacc"
    //         sky_blue = "#99aaff"

    //         neon_yellow_green = "#99d400"
    //         lime_yellow = "#99d433"
    //         light_lime = "#99d466"
    //         pale_mint = "#99d499"
    //         pale_aqua = "#99d4cc"
    //         sky_blue_light = "#99d4ff"

    //         neon_yellow_green_2 = "#99ff00"
    //         lime_bright_2 = "#99ff33"
    //         lime_3 = "#99ff66"
    //         mint_3 = "#99ff99"
    //         aqua_mint_3 = "#99ffcc"
    //         aqua_6 = "#99ffff"

    //         red = "#cc0000"
    //         crimson_2 = "#cc0033"
    //         hot_pink_red = "#cc0066"
    //         magenta = "#cc0099"
    //         bright_magenta = "#cc00cc"
    //         violet_2 = "#cc00ff"

    //         red_orange = "#cc2a00"
    //         dark_red_gray = "#cc2a33"
    //         muted_plum_2 = "#cc2a66"
    //         dusty_purple_2 = "#cc2a99"
    //         lavender_2 = "#cc2acc"
    //         blue_purple_4 = "#cc2aff"

    //         orange = "#cc5500"
    //         burnt_orange = "#cc5533"
    //         muted_red_orange = "#cc5566"
    //         rose = "#cc5599"
    //         pink = "#cc55cc"
    //         bright_pink = "#cc55ff"

    //         golden_brown = "#cc8000"
    //         orange_brown = "#cc8033"
    //         muted_orange = "#cc8066"
    //         dusty_rose = "#cc8099"
    //         pink_lavender = "#cc80cc"
    //         light_purple = "#cc80ff"

    //         gold = "#ccaa00"
    //         golden_yellow = "#ccaa33"
    //         light_gold = "#ccaa66"
    //         pale_gold = "#ccaa99"
    //         pale_cyan = "#ccaacc"
    //         light_sky_blue = "#ccaaff"

    //         yellow = "#ccd400"
    //         bright_yellow = "#ccd433"
    //         yellow_lime = "#ccd466"
    //         pale_lime = "#ccd499"
    //         pale_cyan_2 = "#ccd4cc"
    //         sky_blue = "#ccd4ff"

    //         neon_yellow = "#ccff00"
    //         bright_yellow_2 = "#ccff33"
    //         yellow_lime_2 = "#ccff66"
    //         pale_yellow_green = "#ccff99"
    //         mint_white = "#ccffcc"
    //         ice_blue = "#ccffff"

    //         red_2 = "#ff0000"
    //         bright_red = "#ff0033"
    //         hot_pink_red_2 = "#ff0066"
    //         magenta_2 = "#ff0099"
    //         neon_pink = "#ff00cc"
    //         magenta_purple = "#ff00ff"

    //         red_orange_2 = "#ff2a00"
    //         crimson_orange = "#ff2a33"
    //         pink_red = "#ff2a66"
    //         hot_pink = "#ff2a99"
    //         neon_pink_2 = "#ff2acc"
    //         violet_pink = "#ff2aff"

    //         orange_2 = "#ff5500"
    //         bright_orange = "#ff5533"
    //         coral = "#ff5566"
    //         pink_orange = "#ff5599"
    //         pink_2 = "#ff55cc"
    //         bright_pink_2 = "#ff55ff"

    //         orange_3 = "#ff8000"
    //         bright_orange_2 = "#ff8033"
    //         peach = "#ff8066"
    //         light_pink = "#ff8099"
    //         pink_3 = "#ff80cc"
    //         light_magenta = "#ff80ff"

    //         amber = "#ffaa00"
    //         orange_yellow = "#ffaa33"
    //         peach_2 = "#ffaa66"
    //         light_peach = "#ffaa99"
    //         pale_pink = "#ffaacc"
    //         lavender_pink = "#ffaaff"

    //         gold_yellow = "#ffd400"
    //         bright_gold = "#ffd433"
    //         pale_gold = "#ffd466"
    //         light_gold = "#ffd499"
    //         cream = "#ffd4cc"
    //         lavender_cream = "#ffd4ff"

    //         yellow_2 = "#ffff00"
    //         bright_yellow_3 = "#ffff33"
    //         pale_yellow = "#ffff66"
    //         soft_yellow = "#ffff99"
    //         cream_2 = "#ffffcc"
    //         white = "#ffffff"
    //     }

    //     definitions = {
    //         terminal_background = "black"

    //         loc_background = "black"
    //         loc_color = "white"

    //         line_background = "black"
    //         line_color = "white"

    //         error_background = "bright_red"
    //         error_color = "white"

    //         severeError_background = "dark_red"
    //         severeError_color = "white"

    //         savior_background = "cyan_green_dim"
    //         savior_color = "white"

    //         enabled_background = "transparent"
    //         enabled_color = "lime_green_2"

    //         disabled_background = "transparent"
    //         disabled_color = "red_orange_2"

    //         highlight_background = "magenta_purple"
    //         highlight_color = "white"

    //         editor_background = "black"
    //         editor_color = "white"

    //         editor_loc_background = "black"
    //         editor_loc_color = "white"
    //     }
    //     `).split("\n"))

    DiagnosticService.enable();
}

class OS {
    commandRunning = false;
    programRunning = false;

    // d/mn/Y h:m:s z
    timestamp(template, timestamp) {
        const now = timestamp != null ? new Date(Number(timestamp)) : new Date();

        let dowListShort = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        let dowListLong = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        let monthListShort = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        let monthListLong = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

        const dayOfWeekShort = dowListShort[now.getDay()];
        const dayOfWeekLong = dowListLong[now.getDay()];

        const year = now.getFullYear();
        const yearShort = now.getFullYear().toString().slice(-2);

        const monthNumber = String(now.getMonth() + 1).padStart(2, '0');
        const monthNumberUnpadded = String(now.getMonth() + 1);
        const monthShort = monthListShort[now.getMonth()];
        const monthLong = monthListLong[now.getMonth()]; 

        const day = String(now.getDate()).padStart(2, '0');
        const dayUnpadded = String(now.getDate());
        const ordinalDay = String(now.getDate()) + getOrdinalSuffix(+day);

        const hour24 = String(now.getHours()).padStart(2, '0');
        const hour12 = String((now.getHours() + 11) % 12 + 1).padStart(2, '0');
        const hour24Unpadded = String(now.getHours());
        const hour12Unpadded = String((now.getHours() + 11) % 12 + 1);

        const minute = String(now.getMinutes()).padStart(2, '0');
        const minuteUnpadded = String(now.getMinutes());

        const second = String(now.getSeconds()).padStart(2, '0');
        const secondUnpadded = String(now.getSeconds());

        const millisecond = String(now.getMilliseconds()).padStart(3, '0');
        const millisecondUnpadded = String(now.getMilliseconds());

        const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

        const timezone = new Date().toLocaleString(["en-US"], {timeZoneName: "short"}).split(" ").pop();

        function getISOOffset(date = new Date()) {
            const offset = date.getTimezoneOffset();
            const sign = offset > 0 ? "-" : "+";
            const abs = Math.abs(offset);
            const hours = String(Math.floor(abs / 60)).padStart(2, "0");
            const mins  = String(abs % 60).padStart(2, "0");
            return `${sign}${hours}:${mins}`;
        }

        const isoOffset = getISOOffset(now);

        function getOrdinalSuffix(num) {
            if (typeof num !== "number" || isNaN(num)) return "";
        
            let lastDigit = num % 10;
            let lastTwoDigits = num % 100;
        
            if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return "th";
        
            switch (lastDigit) {
                case 1: return "st";
                case 2: return "nd";
                case 3: return "rd";
                default: return "th";
            }
        }

        // totally not ai
        const replacements = [
            { char: 'w', value: dayOfWeekShort },
            { char: 'W', value: dayOfWeekLong },

            { char: 'Y', value: year },
            { char: 'y', value: yearShort },

            { char: 'mn', value: monthNumber },
            { char: 'mnu', value: monthNumberUnpadded },
            { char: "ms", value: monthShort },
            { char: "M", value: monthLong },

            { char: 'd', value: day },
            { char: 'du', value: dayUnpadded },
            { char: "D", value: ordinalDay },

            { char: 'h', value: hour24 },
            { char: 'hu', value: hour24Unpadded },
            { char: 'H', value: hour12 },
            { char: 'Hu', value: hour12Unpadded },

            { char: 'm', value: minute },
            { char: 'mu', value: minuteUnpadded },

            { char: 's', value: second },
            { char: 'su', value: secondUnpadded },

            { char: 'l', value: millisecond },
            { char: 'lu', value: millisecondUnpadded },

            { char: 'a', value: ampm },

            { char: 'z', value: timezone },
            { char: 'Z', value: isoOffset },
        ];

        let replacementMap = Object.fromEntries(replacements.map(({ char, value }) => [char, value]));

        let dateString = template.replace(/(?<!!)([a-zA-Z]+)/g, (match) => {
            return replacementMap[match] ?? match
        });

        dateString = dateString.replace(/!([a-zA-Z])/g, (_, p1) => {
            return p1;
        });

        return dateString;
    }

    validateCommands(){
        CommandService.listCommands().forEach(name => {
            CommandService.validateCommand(Array.from(name)[0]);
        });
    }

    constructor(elem){
        this.elem = elem;
        this.start = performance.now();
        DiagnosticService.init(this);
        CommandService.init(this);
        defineCommands();
        this.validateCommands();
        CommandExecService.init(this);
        OutputService.init(this);
        SaviorService.init(this);
        FilesystemService.init(this);
        createFilesystem();
        ConfigService.init(this);
        ColorService.init(this);
        BackgroundTaskService.init(this);
        this.end = performance.now();

        console.log(`OS initialized in ${this.end - this.start}ms`);

        function getRealColors(el) {
            let current = el;
            let bg = null;
            let fg = null;

            while (current && current !== document.documentElement) {
                const cs = getComputedStyle(current);

                // Only set bg if we haven't found a real one yet
                if (!bg) {
                    const cBg = cs.backgroundColor;
                    if (cBg !== "transparent" && cBg !== "rgba(0, 0, 0, 0)") {
                        bg = cBg;
                    }
                }

                // Only set fg if we haven't found one yet
                if (!fg) {
                    const cFg = cs.color;
                    if (cFg !== "inherit") {
                        fg = cFg;
                    }
                }

                // If we found both, stop early
                if (bg && fg) break;

                current = current.parentElement;
            }

            // fallback to body values
            const bodyCS = getComputedStyle(document.body);

            return {
                bg: bg || bodyCS.backgroundColor,
                fg: fg || bodyCS.color
            };
        }

        const style = document.createElement("style");
        style.id = "dynamic-selection-style";
        document.head.appendChild(style);

        document.addEventListener("selectionchange", (e) => {
            const sel = document.getSelection();
            if (!sel.rangeCount) return;

            const anchorNode = sel.anchorNode;

            if (!anchorNode) return;

            const node = anchorNode.nodeType === 3
                ? anchorNode.parentElement
                : anchorNode;

            const real = getRealColors(node);

            style.textContent = `
            ::selection {
                background-color: ${real.fg} !important;
                color: ${real.bg} !important;
            }
            `;        
        });

        document.addEventListener("keyup", (e) => {
            if(e.key === "q" && e.ctrlKey && !SaviorService.notified()){
                e.preventDefault();
                CommandExecService.continue();
            }
        });
    }

    async runChain(chain, signal) {
        let pipe = null;

        for (let i = 0; i < chain.parts.length; i++) {
            if (signal.aborted){
                DiagnosticService.record("OS_runChain_aborted");
                throw new DOMException("Aborted", "AbortError");
            }

            signal.chain = { current: i, total: chain.parts.length, chain };

            const result = await this.runSingle(chain.parts[i], signal, pipe);

            if (result?.type === "line") {
                pipe = [result];
            } else if (Array.isArray(result)) {
                pipe = result;
            } else {
                pipe = result ?? null;
            }
        }

        if (Array.isArray(pipe)) {
            for (const line of pipe) OutputService.add(line);
        }

        return pipe;
    }

    async runSingle(fragment, signal, pipe = null) {
        const verification = CommandService.verify(fragment.name, fragment.args, fragment.flags);

        if(verification == undefined){
            throw new OSError(`CommandService is disabled.`);
        }

        if (signal.aborted) {
            DiagnosticService.record("OS_runSingle_aborted");
            throw new DOMException("Aborted", "AbortError");
        }

        if(!Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().includes(fragment.name)){
            throw new OSError(`Unknown command: "${fragment.name}"`);
        }

        const { valid, error } = verification;
        if (!valid) {
            throw new OSError(error);
        }

        fragment.flags = verification.flags;

        const entry = CommandService.commands.get(fragment.name);
        const schema = entry.body.schema || [];
        const flagSchema = schema.filter(s => s.type === "flag" || s.type === "option");

        // Normalize short flags to their full names
        const normalizedFlags = {};
        for (const [key, value] of Object.entries(fragment.flags)) {
            const flagDef = flagSchema.find(s => s.short === key);
            normalizedFlags[flagDef ? flagDef.name : key] = value;
        }

        DiagnosticService.record(`CommandExecService_run ${fragment.name}`);

        const result = await entry.fn({ args: fragment.args, flags: normalizedFlags, pipe }, this, signal);

        if (result?.type === "error") {
            throw new OSError(result.content);
        }
        return result ?? null;
    }

    parsePipeline(input) {
        const parts = [];
        let current = "";

        let inSingle = false;
        let inDouble = false;
        let escape = false;

        for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (escape) {
                current += ch;
                escape = false;
                continue;
            }

            if (ch === "\\") {
                escape = true;
                current += ch;
                continue;
            }

            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
                current += ch;
                continue;
            }

            if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
                current += ch;
                continue;
            }

            if (ch === "|" && !inSingle && !inDouble) {
                if (current.trim()) parts.push(current.trim());
                current = "";
                continue;
            }

            current += ch;
        }

        if (current.trim()) parts.push(current.trim());
        return parts;
    }

    parseCommandFragment(input) {
        const unparsedFlags = [];
        const unparsedArgs = [];

        let current = "";
        let inSingle = false;
        let inDouble = false;
        let escaping = false;

        for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (escaping) {
                current += ch;
                escaping = false;
                continue;
            }

            if (ch === "\\") {
                escaping = true;
                continue;
            }

            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
                current += ch; // keep quotes if you want them
                continue;
            }

            if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
                current += ch; // keep quotes
                continue;
            }

            if (ch === " " && !inSingle && !inDouble) {
                if (current.length > 0) {
                    if (current.startsWith("-")) {
                        unparsedFlags.push(current);
                    } else {
                        unparsedArgs.push(current);
                    }
                    current = ""; // reset token
                }
                continue;
            }

            current += ch;
        }

        // push last token
        if (current.length > 0) {
            if (current.startsWith("-")) {
                unparsedFlags.push(current);
            } else {
                unparsedArgs.push(current);
            }
        }

        const args = [];
        const flags = {};


        function isWrappedInQuotes(str) {
            return (str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"));
        }


        for (const token of unparsedArgs) {
            if(isWrappedInQuotes(token)) {
                args.push(token.slice(1, -1));
            } else {
                args.push(token);
            }
        }

        for (const token of unparsedFlags) {
            let flagName, flagValue;

            const isLongFlag = token.startsWith("--");
            const isShortFlag = token.startsWith("-") && !isLongFlag;

            if (isLongFlag) {
                const flagPart = token.slice(2);

                if (flagPart.includes("=")) {
                    [flagName, flagValue] = flagPart.split("=");
                } else {
                    flagName = flagPart;
                    flagValue = new NoValue();
                }
            } else if (isShortFlag) {
                const flagPart = token.slice(1);
                if (flagPart.includes("=")) {
                    [flagName, flagValue] = flagPart.split("=");
                } else {
                    flagName = flagPart;
                    flagValue = new NoValue();
                }
            } else {
                continue; // skip invalid flag
            }


            if(flagValue instanceof NoValue) {}
            else if(/^-?\d+$/.test(flagValue)) {
                flagValue = Number(flagValue);
            } else if(flagValue === "true" || flagValue === "false") {
                flagValue = flagValue === "true";
            } else if(isWrappedInQuotes(flagValue)) {
                flagValue = flagValue.slice(1, -1);
            }

            flags[flagName] = flagValue;
        }


        const command = args.shift();

        return {
            name: command,
            args,
            flags
        }
    }

    sendCommand(command){
        CommandExecService.enqueue(this.parseCommand(command));
        CommandExecService.enqueue(this.parseCommand("obuffer"));
        CommandExecService.enqueue(this.parseCommand("commandline"));
        CommandExecService.runNext();
    }

    parseCommand(string){
        const pipelines = this.parsePipeline(string);

        const frags = [];

        for (let i = 0; i < pipelines.length; i++) {
            frags.push(this.parseCommandFragment(pipelines[i]));
        }

        return new OSCommandChain(frags);
    }

    line(content, loc = ">"){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');

        contentElem.textContent = content;
        locElem.textContent = loc;

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        return line;
    }

    error(content){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');

        contentElem.textContent = content;
        locElem.textContent = "ERROR";
        locElem.classList.add('error');

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        return line;
    }

    htmlLine(content, loc = ""){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');

        contentElem.innerHTML = content;
        locElem.innerHTML = loc;

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        return line;
    }

    pixelMatrix(content, pixelSize = null){

        pixelSize = pixelSize || ConfigService.get("pixel_size") || 1;

        // Create or reuse canvas
        let canvas = document.createElement("canvas");

        const width = content[0]?.length || 0;
        const height = content.length;

        canvas.width = width * pixelSize;
        canvas.height = height * pixelSize;

        const ctx = canvas.getContext("2d");

        const renderStart = performance.now();
        const template = ConfigService.get("timestamp_template");
        DiagnosticService.record(`OS_pixelMatrix start ${this.timestamp(template)}`);

        const seenColors = new Map();
        let differentColors = 0;
        let totalPixels = width * height;

        // Draw each pixel
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = content[y][x];
                // let closest = '';

                // if (seenColors.has(color)) {
                //     closest = seenColors.get(color);
                // } else {
                //     closest = ColorService.getColor(color);
                //     seenColors.set(color, closest);
                // }

                // closest = ColorService.getColor(color);
                // closest = color;

                // if(color !== closest) differentColors++; 
                ctx.fillStyle = color;
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
            }
        }

        let sadFaceDetected = false;
        try {
            const test = ctx.getImageData(0, 0, 1, 1).data;
            if (test[3] === 0 && test[0] === 0 && test[1] === 0 && test[2] === 0) {
                // top-left pixel should NEVER be fully transparent in your pixel art
                sadFaceDetected = true;
                this.error("Render failed: image width and height too large for current pixel size.");
                return;
            }
        } catch (e) {
            // getImageData can also fail when the canvas is broken
            sadFaceDetected = true;
            this.error("Render failed: image width and height too large for current pixel size.");
            return;
        }

        if (sadFaceDetected) {
            DiagnosticService.record("OS_pixelMatrix render_failed too_large");
        }

        const renderEnd = performance.now() - renderStart;
        DiagnosticService.record(`OS_pixelMatrix end   ${this.timestamp(template)} renderTime=${renderEnd}ms`);
        // get the % of pixels that had a different color than the palette's closest match
        const colorDifference = (differentColors / totalPixels) * 100;
        // DiagnosticService.record(`OS_pixelMatrix color_difference ${colorDifference.toFixed(2)}% (${differentColors} out of ${totalPixels} pixels)`);

        const line = document.createElement("div");
        line.classList.add("line");
        line.appendChild(canvas);
        this.elem.appendChild(line);
    }

    pixelMatrixLegacy(content) {
        const pixel = "██";
        const pixelSize = ConfigService.get("pixel_size") || 1;

        const frag = document.createDocumentFragment(); // buffer

        const renderStart = performance.now();
        const template = ConfigService.get("timestamp_template");
        DiagnosticService.record(`OS_pixelMatrix_start ${this.timestamp(template)}`);

        for (let i = 0; i < content.length; i++) {
            const contentLine = content[i];

            const line = document.createElement("div");
            line.classList.add("line");
            line.style.fontSize = pixelSize + "px";
            line.style.lineHeight = pixelSize + "px";
            line.style.height = pixelSize + "px";
            line.style.marginBottom = "0px";

            const locElem = document.createElement("span");
            locElem.textContent = "";

            const contentElem = document.createElement("div");

            // Build row HTML in memory (NOT DOM)
            let rowHTML = "";
            for (let j = 0; j < contentLine.length; j++) {
                const color = contentLine[j];
                rowHTML += `<span style="color: transparent; background-color: ${color}">${pixel}</span>`;
            }

            contentElem.innerHTML = rowHTML; // one update

            line.appendChild(locElem);
            line.appendChild(contentElem);

            frag.appendChild(line);
        }

        const renderEnd = performance.now() - renderStart;
        DiagnosticService.record(`OS_pixelMatrix_end ${this.timestamp(template)} renderTime=${renderEnd}ms`);

        this.elem.appendChild(frag); // single DOM injection
    }

    savior(content){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');

        contentElem.textContent = content;
        locElem.textContent = "SAVIOR";
        locElem.classList.add('savior');

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        return line;
    }

    severe(content){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');

        contentElem.textContent = content;
        locElem.textContent = "SEVERE ERROR";
        locElem.classList.add('severe');

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        return line;
    }

    commandLine(){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');


        document.querySelectorAll('.commandline').forEach(elem => elem.contentEditable = 'false');


        contentElem.contentEditable = 'plaintext-only';
        contentElem.spellcheck = false;
        contentElem.classList.add('commandline');

        contentElem.addEventListener('keydown', (e) => {
            if(e.key === "Enter"  && contentElem.textContent.trim() === "") {
                e.preventDefault();
                return;
            }
            if(e.key === 'Enter'){
                e.preventDefault();
                this.sendCommand(contentElem.textContent);
                contentElem.contentEditable = 'false';
            }
        });

        document.body.addEventListener('click', (e) => {
            if(!e.target.classList.contains('editor')) {    
                contentElem.focus();
            }
        });


        locElem.textContent = FilesystemService.getCurrentPath() + ">";

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        contentElem.focus();
    }

    parseFormatSpec(input) {
        if (typeof input !== "string")
            throw new OSError("Formatting: Format spec must be a string");

        let i = 0;

        const out = {
            type: null,   // "f" | "b" | "a"
            start: null,  // number | null
            end: null,    // number | null
            color: null,  // string | null
            style: ""     // string (unique flags)
        };

        const seen = new Set();

        function readUntil(ch) {
            let start = i;
            while (i < input.length && input[i] !== ch) i++;
            if (i >= input.length)
                throw new OSError("Formatting: Missing '" + ch + "'");
            return input.slice(start, i);
        }

        while (i < input.length) {

            // key
            const key = readUntil("=");
            i++; // skip '='

            // value
            const value = readUntil(";");
            i++; // skip ';'

            if (seen.has(key))
                throw new OSError(`Formatting: Duplicate field '${key}'`);

            seen.add(key);

            switch (key) {

                case "type":
                    if (value !== "f" && value !== "b" && value !== "a")
                        throw new OSError("Formatting: type must be 'f', 'b', or 'a'");
                    out.type = value;
                    break;

                case "s": {
                    if (!/^\d+$/.test(value))
                        throw new OSError("Formatting: s (start) must be a non-negative integer");
                    out.start = Number(value);
                    break;
                }

                case "e": {
                    if (!/^\d+$/.test(value))
                        throw new OSError("Formatting: e (end) must be a non-negative integer");
                    out.end = Number(value);
                    break;
                }

                case "c":
                    // allow any non-empty string (CSS color is validated later by the renderer)
                    if (value.length === 0)
                        throw new OSError("Formatting: c (color) cannot be empty");
                    out.color = value;
                    break;

                case "t": {
                    if (!/^[ibus]*$/.test(value))
                        throw new OSError("Formatting: t (style) may only contain i, b, u, s");

                    // normalize: unique characters, keep first appearance order
                    let normalized = "";
                    for (const ch of value) {
                        if (!normalized.includes(ch))
                            normalized += ch;
                    }

                    out.style = normalized;
                    break;
                }

                default:
                    throw new OSError(`Formatting: Unknown field '${key}'`);
            }
        }

        if (out.type === null)
            throw new OSError("Formatting: Missing required field 'type'");

        // Optional sanity check
        if (out.start !== null && out.end !== null && out.end < out.start)
            throw new OSError("Formatting: e (end) cannot be less than s (start)");

        return out;
    }

    openEditor(file){
        const styles = FilesystemService.resolvePath(`/data/editor_styling.conf`, "full");

        const styleObject = new SwagObjectParser(styles.read()).parse();

        if(styleObject[file.type] == undefined){
            throw new OSError(`No editor styling found for files of type "${file.type}"`);
        }

        if(styleObject[file.type].loc == undefined){
            throw new OSError(`No "loc" property found in editor styling for files of type "${file.type}"`);
        }

        if(styleObject[file.type].current_line_indicator == undefined){
            throw new OSError(`No "current_line_indicator" property found in editor styling for files of type "${file.type}"`);
        }


        let locIndicator = styleObject[file.type].loc;
        let currentLineIndicator = styleObject[file.type].current_line_indicator;

        const editorLine = document.createElement('div');
        const ecmdInLine = document.createElement('div');
        const ecmdOutLine = document.createElement('div');

        editorLine.classList.add('line');
        ecmdInLine.classList.add('line');
        ecmdOutLine.classList.add('line');

        const loc = document.createElement('span');
        const ecmdInLoc = document.createElement('span');
        const ecmdOutLoc = document.createElement('span');

        ecmdInLoc.textContent = "-";
        ecmdOutLoc.textContent = "-";

        const editor = document.createElement('textarea');
        const ecmdIn = document.createElement('div');
        const ecmdOut = document.createElement('div');

        const styleDiv = document.createElement('div');

        ecmdInLine.appendChild(ecmdInLoc);
        ecmdInLine.appendChild(ecmdIn);

        ecmdOutLine.appendChild(ecmdOutLoc);
        ecmdOutLine.appendChild(ecmdOut);

        editor.classList.add('editor');
        loc.classList.add('editor');

        editor.value = file.read(true);

        editor.spellcheck = false;

        function updateLOC() {
            const text = editor.value;
            const lines = text.split("\n");

            const cursorPos = editor.selectionStart;
            const currentLine = text.substring(0, cursorPos).split("\n").length - 1;


            // fix

            const baseLocIndicator = locIndicator;
            const baseCurrentIndicator = currentLineIndicator;

            loc.textContent = lines
                .map((_, i) => {
                    const normal = baseLocIndicator.replace("$lineno", (i + 1));
                    const current = baseCurrentIndicator.replace("$lineno", (i + 1));

                    return i === currentLine ? current : normal;
                })
                .join("\n");
        }


        requestAnimationFrame(() => {
            editor.style.height = "auto";
            editor.style.height = editor.scrollHeight + "px";

            updateLOC();
        });

        editor.addEventListener("input", () => {
            editor.style.height = "auto";
            editor.style.height = editor.scrollHeight + "px";
            updateLOC();
            styleDiv.innerText = editor.value;
        });

        let ecmdInUse = false;

        editor.addEventListener("keydown", (e) => {
            if(e.key === "F1" && ecmdInUse == false){
                ecmdInUse = true;
                e.preventDefault();
                ecmdIn.contentEditable = "true";
                ecmdIn.focus();
                ecmdInLoc.textContent = "ECMD>";
            }
        });

        ecmdIn.addEventListener("keydown", (e) => {
            if(e.key === "F1" && ecmdInUse){
                ecmdInUse = false;
                e.preventDefault();
                ecmdIn.contentEditable = "false";
                editor.focus();
                ecmdInLoc.textContent = "-";
            }

            if(e.key === "Enter"){
                e.preventDefault();

                const command = ecmdIn.textContent.trim();

                switch(command){
                    case "s": {
                        file.write(editor.value.split("\n"));
                        ecmdOut.textContent = "File saved.";
                    } break;

                    case "q": {
                        editor.readOnly = true;
                        ecmdIn.contentEditable = "false";
                        ecmdInLoc.textContent = "-";
                        ecmdOut.textContent = "Exited editor.";
                        CommandExecService.continue();
                    } break;

                    case "sq": {
                        file.write(editor.value.split("\n"));
                        editor.readOnly = true;
                        ecmdIn.contentEditable = "false";
                        ecmdInLoc.textContent = "-";
                        ecmdOut.textContent = "File saved and exited editor.";
                        CommandExecService.continue();
                    } break;

                    case "c": {
                        ecmdOut.textContent = "";
                    } break;

                    case "?": {
                        ecmdOut.innerHTML = `sq - save and quit<br>s  - save<br>q  - quit without saving<br>c  - clear this command output<br>?  - show this help message`;
                    } break;
                }

                ecmdIn.textContent = "";
            }
        })

        document.addEventListener("selectionchange", () => {
            if(document.activeElement === editor){
                updateLOC();
            }
        });

        editorLine.appendChild(loc);
        editorLine.appendChild(editor);

        const intro = `--- Editing: ${file.fullName()} ---`;
        

        this.elem.appendChild(ecmdInLine);
        this.elem.appendChild(ecmdOutLine);

        this.line(intro, "");
        this.line(`Press [F1] toggle between the editor and the command bar, type "?" there for commands.`, "");
        this.line("-".repeat(intro.length), "");
        this.elem.appendChild(editorLine);
        editor.focus();
    }
}

export default OS;