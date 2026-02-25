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
    constructor(message){
        super(message);
        this.name = "OSError";
    }
}

class SaviorService {
    static os = null;
    static enabled = false;

    static name = "SaviorService";

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

    static name = "OutputService";

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
            else if(line.type === "savior") this.os.savior(line.content);
            else if(line.type === "html") this.os.htmlLine(line.content, line.loc);
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

    static name = "DiagnosticService";

    static diagnosticData = [];

    static enable(){
        this.enabled = true;
    }

    static disable(){
        this.enabled = false;
    }

    static init(os) {
        if(this.os) return;
        this.os = os;
        this.enabled = true;
    }

    static record(action){
        if(!this.enabled) return;
        this.diagnosticData.push({ action, timestamp: Date.now() });
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

    static name = "CommandExecService";

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

        this.queue = [];
        DiagnosticService.record("CommandExecService_interrupt");

        if (this.currentAbort) {
            this.currentAbort.abort();
        }
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
            this.runNext();
        });
    }

    static async runNext() {
        if(!this.enabled) return;
        if (!this.os) throw new Error("CommandExecService not initialized with OS instance");
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
            resolve(result);
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") {
                OutputService.add({ type: "error", content: "Command execution interrupted." });
                OutputService.flush();
                resolve(null);
            } else if (e instanceof OSError) {
                DiagnosticService.record("CommandExecService_commandError " + chain.simplify());
                OutputService.add({ type: "error", content: e.message });
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

class CommandService {
    static os = null;
    static enabled = false;
    static commands = new Map();
    static registeredCommands = new Set();

    static name = "CommandService";

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

    static defineCommand(name, body, fn){
        if(!this.enabled) return;
        this.commands.set(name, {body, fn});
        DiagnosticService.record(`CommandService_define ${name}`);

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

        DiagnosticService.record(`CommandService_register ${name}`);
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

        DiagnosticService.record(`CommandService_verify ${name}`);

        if(!entry){
            return { valid: false, error: `Unknown command: "${name}"` };
        }

        const schema = entry.body.schema || [];

        const positionalSchema = schema.filter(s => s.type === "positional");
        const flagSchema = schema.filter(s => s.type === "flag" || s.type === "option");

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

            let flagType = flagDef.datatype;

            if(flagType === undefined){
                CommandService.unregisterCommand(name);
                return { valid: false, error: `Flag definition for "--${flagDef.name}" is missing datatype (string, num, bool)` };
            }

            let actualType = typeof flags[flagName];

            if(/-?\d+/.test(flags[flagName])){
                actualType = "number";
                flags[flagName] = Number(flags[flagName]);
            }

            if(flagType !== actualType){
                return { valid: false, error: `Invalid value for flag "--${flagDef.name}": expected ${flagType}, got ${actualType}` };
            }

            if(flagDef.default && typeof flagDef.default !== flagType){
                CommandService.unregisterCommand(name);
                return { valid: false, error: `Invalid default value for flag "--${flagDef.name}"` };
            }
        }

        return { valid: true, error: null, flags };
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
                description: "Some services are critical for the operation of the OS. Use this flag to confirm that you want to enable/disable such services",
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
            }
        ]
    }, (params, os, signal) => {
        const action = params.args[0];
        if(action === "logs"){
            if(params.flags.clear){
                DiagnosticService.diagnosticData.length = 0;
            }
            const uncompressed = DiagnosticService.getData().map(entry => `[${os.timestamp('d/mn/Y h:m:s.l z', entry.timestamp)}] ${entry.action}`); //

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

            // split the timestamp and the rest of the line and put the timestamp in the loc part of the line


            return compressed.map(x => ({ type: "line", content: x, loc: "" }));
        } else if(action === "list"){

            const services = [OutputService, CommandExecService, CommandService, DiagnosticService, SaviorService];
            const lines = [];
            const max = Math.max(...services.map(s => s.name.length));

            services.forEach(service => {
                lines.push({ type: "html", content: `${service.name.padEnd(max, " ")} : ${service.enabled ? "<span class='enabled'>ENABLED</span>" : "<span class='disabled'>DISABLED</span>"}`, loc: "" });
            });

            return lines;

        } else if(action === "enable" || action === "disable"){
            const serviceName = params.args[1];
            if(!serviceName) return { type: "error", content: "Service name is required for enable/disable action" };

            const serviceMap = {
                "output": OutputService,
                "commandexec": CommandExecService,
                "command": CommandService,
                "diagnostic": DiagnosticService,
                "savior": SaviorService,
            };


            const criticalServices = ["commandexec", "savior", "command"];

            const service = serviceMap[serviceName.toLowerCase()];

            if(!service) return { type: "error", content: `Unknown service: "${serviceName}". Valid services are: ${Object.keys(serviceMap).join(", ")}` };
            if(action === "enable"){
                service.enable();
                return { type: "line", content: `Enabled ${serviceName} service`, loc: "" };
            } else {
                if(criticalServices.includes(serviceName.toLowerCase()) && !params.flags.confirm){
                    return { type: "error", content: `The "${serviceName}" service is critical for the operation of the OS. Use --confirm flag to confirm that you want to disable it.` };
                }
                service.disable();
                return { type: "line", content: `Disabled ${serviceName} service`, loc: "" };
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

    CommandService.bulkRegister(["print", "obuffer", "commandline", "linecount", "help", "clear", "service", "findtext"]);
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
        DiagnosticService.init(this);
        CommandService.init(this);
        defineCommands();
        this.validateCommands();
        CommandExecService.init(this);
        OutputService.init(this);
        SaviorService.init(this);

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
        let i = 0;
        let current = "";
        let args = [];
        let quotedArgs = [];

        let inDoubleQuotes = false;
        let inSingleQuotes = false;

        let tokenStartedQuoted = false;

        while (i < input.length) {
            const c = input[i];

            if (c === '\\') {
                const next = input[i + 1];

                if (next === ' ' || next === '"' || next === "'" || next === '\\') {
                    current += next;
                    i += 2;
                    continue;
                }

                current += '\\';
                i++;
                continue;
            }
            else if (c === '"' && !inSingleQuotes) {
                if (!inDoubleQuotes && current.length === 0)
                    tokenStartedQuoted = true;

                inDoubleQuotes = !inDoubleQuotes;
            }
            else if (c === "'" && !inDoubleQuotes) {
                if (!inSingleQuotes && current.length === 0)
                    tokenStartedQuoted = true;

                inSingleQuotes = !inSingleQuotes;
            }
            else if (c === " " && !inDoubleQuotes && !inSingleQuotes) {
                if (current.length > 0) {
                    args.push(current);
                    quotedArgs.push(tokenStartedQuoted);
                    current = "";
                    tokenStartedQuoted = false;
                }
            } else {
                current += c;
            }

            i++;
        }

        if (current.length > 0) {
            args.push(current);
            quotedArgs.push(tokenStartedQuoted);
        }

        const [command, ...rest] = args;
        const restQuoted = quotedArgs.slice(1);

        const positional = [];
        const flags = {};

        for (let j = 0; j < rest.length; j++) {
            const token = rest[j];
            const isQuoted = restQuoted[j];

            if (isQuoted) {
                positional.push(token);
            }
            else if (token.startsWith("--")) {
                const flagPart = token.slice(2);
                if (flagPart.includes("=")) {
                    const [flag, value] = flagPart.split("=");
                    flags[flag] = value;
                } else {
                    flags[flagPart] = true;
                }
            }
            else if (token.startsWith("-") && token.length > 1) {
                const flagPart = token.slice(1);
                if (flagPart.includes("=")) {
                    const [flag, value] = flagPart.split("=");
                    flags[flag] = value;
                } else {
                    flags[flagPart] = true;
                }
            } else {
                positional.push(token);
            }
        }

        return {
            name: command,
            args: positional,
            flags
        };
    }

    sendCommand(command){
        CommandExecService.enqueue(this.parseCommand(command));
        CommandExecService.enqueue(this.parseCommand("obuffer"));
        CommandExecService.enqueue(this.parseCommand("commandline"));
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

    commandLine(loc = ">"){
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

        locElem.textContent = loc;

        line.classList.add('line');
        line.appendChild(locElem);
        line.appendChild(contentElem);
        this.elem.appendChild(line);

        contentElem.focus();
    }
}

export default OS;