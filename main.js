import OS from './lib.js';

const os = new OS(document.getElementById('terminal'));

os.line('Welcome to swagOS2 ===', "===");
os.commandLine();
// os.sendCommand('p c/u | lc')
// os.sendCommand("p c/u | service logs | service logs")
// os.sendCommand("service logs | p c/u | service logs")