import OS from './lib.js';

const os = new OS(document.getElementById('terminal'));

os.line('Welcome to swagOS2 ===', "===");
os.commandLine();
os.sendCommand("ls | find [")