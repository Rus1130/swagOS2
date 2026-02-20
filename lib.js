class OSCommandChain {
    constructor(parts){
        this.parts = parts;
    }

    addPart(part){
        this.parts.push(part);
    }
}

class OSError extends Error {
    constructor(message){
        super(message);
        this.name = "OSError";
    }
}

class CommandService {
    static commands = new Map();
    static registeredCommands = new Set();

    static defineCommand(name, body, fn){
        this.commands.set(name, {body, fn});

        if(body.options && body.options.alias){
            let aliasBody = structuredClone(body);
            delete aliasBody.options.alias;

            aliasBody.aliasOf = name;
            this.commands.set(body.options.alias, {body: aliasBody, fn});
        }
    }

    static getCommand(name){
        if(!Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().includes(name)) return null;
        return this.commands.get(name);
    }

    static listCommands(){
        return Array.from(CommandService.registeredCommands);
    }

    static unregisterCommand(name){
        if(!CommandService.registeredCommands.has(name)) return;
        const entry = this.commands.get(name);
        if(!entry) throw new Error(`Cannot unregister unknown command: "${name}"`);

        const commandNames = new Set();

        commandNames.add(name);
        if(entry.body.options.alias) commandNames.add(entry.body.options.alias);

        CommandService.registeredCommands.delete(commandNames);
    }

    static registerCommand(name){
        if(CommandService.registeredCommands.has(name)) return;
        const entry = this.commands.get(name);
        if(!entry) throw new Error(`Cannot register unknown command: "${name}"`);

        const commandNames = new Set();

        commandNames.add(name);
        if(entry.body.options.alias) commandNames.add(entry.body.options.alias);

        CommandService.registeredCommands.add(commandNames);
    }

    static bulkRegister(names){
        for(const name of names){
            this.registerCommand(name);
        }
    }

    static bulkUnregister(names){
        for(const name of names){
            this.unregisterCommand(name);
        }
    }

    static verify(name, args, flags){
        const entry = this.commands.get(name);

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
            pipeableFrom: "text"
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
    if(commandName){
        const entry = CommandService.getCommand(commandName);
        if(!entry) throw new OSError(`Unknown command: "${commandName}"`);

        let name = commandName;
        if(entry.body.aliasOf) name = entry.body.aliasOf;

        if(flags.verbose){
            let usage = `Usage: ${name}`;
            let descriptions = [];
            const positionalArgs = entry.body.schema ? entry.body.schema.filter(s => s.type === "positional") : [];
            const flags = entry.body.schema ? entry.body.schema.filter(s => s.type === "flag" || s.type === "option") : [];

            for(const param of positionalArgs){
                if(param.type === "positional" && param.required){
                    usage += ` <${param.name}>`;
                } else if(param.type === "positional" && !param.required){
                    usage += ` [${param.name}]`;
                }
            }

            if(entry.body.aliasOf){
                descriptions.push({ type: "line", content: `Alias of: ${entry.body.aliasOf}`, loc: "" });
            } else if (entry.body.options.alias){
                descriptions.push({ type: "line", content: `Alias: ${entry.body.options.alias}`, loc: "" });
            }

            for(const param of flags){
                let flagPart = `-${param.short}|--${param.name}`;
                if((param.type === "flag") && param.required){
                    usage += ` ${flagPart}=<${param.datatype}>`;
                } else if(param.type === "flag" && !param.required){
                    usage += ` [${flagPart}=<${param.datatype}>]`;
                }
            }

            descriptions.push({ type: "line", content: "", loc: "" });

            for(const param of positionalArgs){
                descriptions.push({ type: "line", content: `${param.name}: ${param.description || "No description available"}`, loc: "" });
                descriptions.push({ type: "line", content: `    Type: positional`, loc: "" });
                descriptions.push({ type: "line", content: `    Required: ${param.required ? "Yes" : "No"}`, loc: "" });
                descriptions.push({ type: "line", content: "", loc: "" });
            }

            for(const param of flags){
                let flagPart = `-${param.short}|--${param.name}`;
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
            ]

        } else {
            let usage = `Usage: ${name}`;
            const positionalArgs = entry.body.schema ? entry.body.schema.filter(s => s.type === "positional") : [];
            const flags = entry.body.schema ? entry.body.schema.filter(s => s.type === "flag" || s.type === "option") : [];

            for(const param of positionalArgs){
                if(param.type === "positional" && param.required){
                    usage += ` <${param.name}>`;
                } else if(param.type === "positional" && !param.required){
                    usage += ` [${param.name}]`;
                }
            }

            for(const param of flags){
                let flagPart = param.short ? `-${param.short}` : `--${param.name}`;
                if((param.type === "flag") && param.required){
                    usage += ` ${flagPart}`;
                } else if(param.type === "flag" && !param.required){
                    usage += ` [${flagPart}]`;
                }
            }


            return [
                { type: "line", content: usage, loc: "" },
                { type: "line", content: entry.body.options.description || "No description available", loc: "" },
            ]
        }
    }

    const commands = Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().filter(name => {
        const entry = CommandService.getCommand(name);
        return !entry.body.aliasOf;
    }).map(name => {
        const entry = CommandService.getCommand(name);
        
        if(entry.body.options.hidden) return null;
        if(flags.aliases){
            const aliases = Array.from(CommandService.commands.entries()).filter(([n, e]) => e.body.aliasOf === name).map(([n, e]) => n);
            if(aliases.length > 0){
                return `${name} (${aliases.join(", ")})`;
            }
        }
        return name;
    }).filter(x => x !== null).sort((a, b) => a.localeCompare(b));
    return [
        {
            type: "line",
            content: "Available commands:",
            loc: ""
        }, {
            type: "line",
            content: commands.join(", "),
            loc: ""
        }
    ]
});


CommandService.bulkRegister(["print", "obuffer", "commandline", "linecount", "help", "clear"]);

class OutputService {
    static buffer = [];
    static os = null;
    static enabled = false;

    static enable(){
        this.enabled = true;
    }

    static disable(){
        this.enabled = false;
    }

    static init(os) {
        if(this.os) return;
        this.buffer = [];
        this.os = os;
        this.enabled = true;
    }

    static add(line) {
        if(!this.enabled) return;
        this.buffer.push(line);
    }

    static flush() {
        if(!this.enabled) return;
        for(const line of this.buffer){
            this.os.line(line.content, line.loc);
        }
        this.buffer.length = 0;
    }

    static clear() {
        if(!this.enabled) return;
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

    static enable(){
        this.enabled = true;
    }

    static disable(){
        this.enabled = false;
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

    static diagnostics = {
        totalExecuted: 0,
        totalTime: 0,
    }

    static enable(){
        this.enabled = true;
    }

    static disable(){
        this.enabled = false;
    }

    static interrupt(err) {
        if(!this.enabled) return;
        if (!this.os) return;

        this.queue.length = 0;

        if (this.currentAbort) {
            this.currentAbort.abort();
        }

        if (this.currentReject) {
            this.currentReject(err);
            this.currentReject = null;
        }
    }

    static init(os) {
        if(this.os) return;
        this.queue = [];
        this.running = false;
        this.os = os;
        this.enabled = true;
    }

    static enqueue(chain) {
        if(!this.enabled) return;
        if(!this.os) throw new Error("CommandExecService not initialized with OS instance");
        return new Promise((resolve, reject) => {
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
            if (e.name === "AbortError") {
                // silent
            } else if (e instanceof OSError) {
                this.os.error(e.message);
            } else {
                this.os.error(`A JavaScript error occurred.`);
                console.error(e);
            }
            resolve(null);
        } finally {
            this.currentAbort = null;
            this.currentReject = null;
            this.running = false;
            this.runNext();
        }
    }
}

class OS {

    commandRunning = false;

    constructor(elem){
        this.elem = elem;
        CommandExecService.init(this);
        OutputService.init(this);
    }

    async runChain(chain, signal) {
        let pipe = null;

        for (let i = 0; i < chain.parts.length; i++) {
            if (signal.aborted)
                throw new DOMException("Aborted", "AbortError");

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
        if (signal.aborted)
            throw new DOMException("Aborted", "AbortError");

        if(!Array.from(CommandService.registeredCommands).map(x => Array.from(x)).flat().includes(fragment.name)){
            throw new OSError(`Unknown command: "${fragment.name}"`);
        }

        const { valid, error } = CommandService.verify(fragment.name, fragment.args, fragment.flags);
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

    commandLine(loc = ">"){
        const line = document.createElement('div');
        const contentElem = document.createElement('div');
        const locElem = document.createElement('span');


        document.querySelectorAll('.commandline').forEach(elem => elem.contentEditable = 'false');


        contentElem.contentEditable = 'plaintext-only';
        contentElem.spellcheck = false;
        contentElem.classList.add('commandline');

        contentElem.addEventListener('keydown', (e) => {
            if(e.key === 'Enter'){
                e.preventDefault();
                this.sendCommand(contentElem.textContent);
                contentElem.contentEditable = 'false';
            }
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