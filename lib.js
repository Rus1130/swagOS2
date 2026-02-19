class OSCommandChain {
    constructor(parts){
        this.parts = parts;
    }

    addPart(part){
        this.parts.push(part);
    }
}

class CommandService {
    static queue = [];
    static running = false;
    static os = null;

    static init() {
        if(this.os) return; // already initialized
        this.queue = [];
        this.running = false;
    }

    // push a command as an async function
    // fn must return a Promise
    static enqueue(chain) {
        if(!this.os) throw new Error("CommandService not initialized with OS instance");
        return new Promise((resolve, reject) => {
            this.queue.push({ chain, resolve, reject });
            this.#runNext();
        });
    }

    static async #runNext() {
        if(!this.os) throw new Error("CommandService not initialized with OS instance");
        if (this.running) return;
        if (this.queue.length === 0) return;

        this.running = true;

        const { chain, resolve, reject } = this.queue.shift();

        try {
            const result = await console.log(chain);   // wait for previous command to finish
            resolve(result);
        } catch (e) {
            reject(e);
        } finally {
            this.running = false;
            this.#runNext(); // start next command
        }
    }
}

class OS {
    constructor(elem){
        this.elem = elem;
        CommandService.os = this;
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

                // only count as quoted token if the quote opens the token
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

        contentElem.contentEditable = 'plaintext-only';

        contentElem.addEventListener('keydown', (e) => {
            if(e.key === 'Enter'){
                e.preventDefault();
                CommandService.enqueue(this.parseCommand(contentElem.textContent));
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