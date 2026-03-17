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

        for(const [key, value] of Object.entries(paletteData)){
            document.documentElement.style.setProperty(`--${key}`, value);
        }
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

        return { valid: true, error: null, flags };
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
            node.parent.children.delete(node.name);
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
            if (!children.has(givenName)) return null;
            const child = children.get(givenName);

            // exact file type required
            if (child instanceof OSFile && child.type !== givenType) return null;

            node = child;
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
            throw new OSError(`Ambiguous path segment '${rawPart}'`);
        }

        node = matches[0];
    }

    DiagnosticService.record(
        `FilesystemService_resolvePath ${path} -> ${
            node instanceof OSDirectory ? "directory" : "file"
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
     * @param {string} name 
     * @param {string} type 
     * @param {string} parentPath 
     * @param {string[]} content 
     * @returns 
     */
    static createFile(name, type, parentPath, content = []) {
        if (!this.enabled) throw new OSError("FilesystemService is disabled");

        if (!this.validationRegex.test(name)) {
            throw new OSError(`Invalid file name: "${name}". Only alphanumeric characters, underscores, hyphens, and periods are allowed.`);
        }

        const parentDir = parentPath ? this.resolvePath(parentPath) : this.currentDirectory;
        if (!parentDir || !(parentDir instanceof OSDirectory)) return null;

        const file = new OSFile(name, type, parentDir, content);

        if (parentDir.children.has(name)) {
            throw new OSError(`A file or directory with the name "${name}" already exists in "${parentDir.name}".`);
        }

        parentDir.children.set(name, file);
        DiagnosticService.record(`FilesystemService_createFile ${name} -> ${parentDir.name}`);
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

        SaviorService.watch(CommandExecService);
        SaviorService.watch(CommandService);

        setInterval(() => {
            if(!this.enabled) return;

            // get the last line in the console
            const lines = Array.from(this.os.elem.querySelectorAll(".line")).map(x => Array.from(x.children));
            const lastLine = lines[lines.length - 1];
            if(lastLine && !lastLine[1].classList.contains("commandline")){
                this.os.commandLine();
            }
        }, 10_000);
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
        for(const line of this.buffer){
            if(line.type === "line") this.os.line(line.content, line.loc);
            else if(line.type === "error") this.os.error(line.content);
            else if(line.type === "severe_error") this.os.severe(line.content);
            else if(line.type === "savior") this.os.savior(line.content);
            else if(line.type === "html") this.os.htmlLine(line.content, line.loc);
            else {
                console.error(`OutputService: Unknown line type: ${line.type}`, line);
                throw new OSError(`OutputService: Unknown line type: ${line.type}`);
            }
        }
        DiagnosticService.record("OutputService_flush");
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
    }

    static continue(){
        if(!this.enabled) return;
        if (!this.os) throw new OSError("CommandExecService not initialized with OS instance");

        //CommandExecService.queue.length = 0;

        DiagnosticService.record("CommandExecService_continue");
        this.enqueue(this.os.parseCommand("obuffer"));
        this.enqueue(this.os.parseCommand("commandline"));
        this.runNext();
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

class ServiceManager {
    static services = [OutputService, CommandExecService, CommandService, DiagnosticService, SaviorService, FilesystemService, ConfigService, ColorService];
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
            service.abbreviation = "Psrv";
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
            service.abbreviation = "Msrv";
            service.shortName = "command";
            service.critical = true;
        } break;

        case ColorService: {
            service.abbreviation = "Rsrv";
            service.shortName = "color";
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

    constructor(name, type, parent, content = []) {
        this.name = name;
        this.type = type;
        this.parent = parent; // parent directory
        this.#content = content;
        this.#size = OSFile.calculateSize(content);
    }

    fullName() {
        return `${this.name}.${ this.type}`;
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

    read() {
        return this.#content;
    }

    write(newContent) {
        this.#content = newContent;
        this.#size = OSFile.calculateSize(newContent);
    }

    getSize(formatted = false){

        if(formatted == false) return this.#size;

        const total = this.#size;

        if (total < 1024) {
            // B → KB
            return `${total} B`;
        }
        else if (total < 1024 * 1024) {
            const kb = total / 1024;
            return `${kb.toFixed(2)} KB (${total} B)`;
        }
        else if (total < 1024 * 1024 * 1024) {
            const kb = total / 1024;
            const mb = total / (1024 * 1024);
            return `${mb.toFixed(2)} MB (${kb} KB)`;
        }
        else {
            const mb = total / (1024 * 1024);
            const gb = total / (1024 * 1024 * 1024);
            return `${gb.toFixed(2)} GB (${mb} MB)`;
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
            }
        ]
    }, (params, os, signal) => {
        const action = params.args[0];
        if(action === "logs"){
            if(params.flags.clear){
                DiagnosticService.diagnosticData.length = 0;
                return;
            }

            const uncompressed = [];

            const timestamp = ConfigService.get("timestamp_template");

            DiagnosticService.getData().forEach(entry => {
                if(entry.type === "record"){
                    uncompressed.push(`[${os.timestamp(timestamp, entry.data.timestamp)}] ${entry.data.message}${params.flags.trace ? `\n    ${entry.data.stack.join(" -> ")}` : ""}`);
                } else if(entry.type === "note"){
                    uncompressed.push(`[${os.timestamp(timestamp, entry.data.timestamp)}] [NOTE] ${entry.data.message}`);
                }
            });

            const compressed = [];
            let increment = 0;
            for(let i = 0; i < uncompressed.length; i++){
                let lastEntry = compressed[compressed.length - 1];
                let currentEntry = uncompressed[i];
                if(lastEntry == undefined) {
                    compressed.push(currentEntry);
                    continue;
                }


                if(currentEntry === lastEntry){
                    increment++;
                } else {
                    if(increment > 0){
                        compressed[compressed.length - 1] = `${lastEntry} (x${increment + 1})`;
                        increment = 0;
                    }
                    compressed.push(currentEntry);
                }
            }

            let lastStamp = null;
            for (let i = 0; i < compressed.length; i++) {

                let line = compressed[i];

                // match the timestamp inside the first [...]
                let m = line.match(/^\[([^\]]*)\]/);
                if (!m) continue;

                let stamp = m[1];

                if (stamp === lastStamp) {
                    let blank = " ".repeat(stamp.length);
                    compressed[i] = line.replace(/^\[[^\]]*\]/, `[${blank}]`);
                } else {
                    lastStamp = stamp;
                }
            }

            return compressed.map(x => {
                const m = x.match(/^\[([^\]]*)\] (.*)$/s);
                if (!m) return { type: "line", content: x, loc: "" };
                return { type: "line", content: m[2], loc: "["+m[1]+"]" };
            });
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
        if(flags.recursive){
            const recurseAmount = flags.recursive > 0 ? flags.recursive : Infinity;

            console.log(recurseAmount)

            const dir = FilesystemService.resolvePath(FilesystemService.getCurrentPath());

            const lines = [];

            const listRecursive = (directory, prefix = "", level = 0) => {
                if (level >= recurseAmount) return;

                const entries = directory.list();

                const lastIndex = entries.length - 1;

                entries.forEach((entry, index) => {
                    const isLast = index === lastIndex;

                    const spacing = flags.spacing ?? 2;

                    // Tree characters
                    const branch = (isLast ? "└" : "├") + "─".repeat(spacing - 1);
                    const nextPrefix = prefix + (isLast ? (" " + " ".repeat(spacing)) : ("│" + ' '.repeat(spacing)));

                    if (entry instanceof OSDirectory) {
                        lines.push({ type: "line", content: entry.name, loc: prefix + branch });
                        listRecursive(entry, nextPrefix, level + 1);
                    } else {
                        let line = entry.fullName();
                        if(flags.size) line += ` (${entry.getSize(true)})`;
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
        ]
    }, ({args, pipe, flags}, os, signal) => {
        const path = args[0];

        try {
            const file = FilesystemService.resolvePath(path, "full");
            if(!(file instanceof OSFile)) throw new OSError(`"${path}" is not a file`);

            const lines = [{ type: "line", content: `--- Contents of "${file.fullName()}" ---`, loc: "" }];

            file.read().forEach(line => {
                lines.push({ type: "line", content: line, loc: ":" });
            })

            return lines;
        } catch (e) {
            if(e instanceof OSError) return { type: "error", content: e.message, loc: "" };
            else { 
                console.error(e);
                return { type: "error", content: `An unexpected error occurred while reading the file. Check console for details.`, loc: "" }; 
            }
        }
    });

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


    CommandService.bulkRegister(["print", "obuffer", "commandline", "linecount", "help", "clear", "service", "findtext", "makefile", "makedirectory", "list", "changedirectory", "peek", "time", "colortest", "fileinfo", "remove", "config"]);
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
    FilesystemService.createDirectory("config", "/")
    FilesystemService.createDirectory("data", "/")
    FilesystemService.createDirectory("palettes", "/data")

    FilesystemService.createFile("user", "conf", "/config",
        normalizeIndentation(
            `
            timestamp_template = "d/mn/Y h:m:s.l"
            color_palette = "default"
            `, 12
        ).split("\n")
    );

    FilesystemService.createFile("default", "conf", "/data/palettes", 
        normalizeIndentation(
            `
            terminal_background = "#000000"

            loc_background = "#000000"
            loc_color = "#FFFFFF"

            line_background = "#000000"
            line_color = "#FFFFFF"

            error_background = "#FF0000"
            error_color = "#FFFFFF"

            severeError_background = "#8B0000"
            severeError_color = "#FFFFFF"

            savior_background = "#5a5a5a"
            savior_color = "#FFFFFF"

            enabled_background = "transparent"
            enabled_color = "#90ee90"

            disabled_background = "transparent"
            disabled_color = "#ff5e5e"

            highlight_background = "#d862ff"
            highlight_color = "#FFFFFF"
            `, 12
        ).split("\n"))

    DiagnosticService.enable();
}

class OS {
    commandRunning = false;

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

        document.body.addEventListener('click', () => {
            contentElem.focus();
        });

        locElem.textContent = FilesystemService.getCurrentPath() + ">";

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        contentElem.focus();
    }
}

export default OS;