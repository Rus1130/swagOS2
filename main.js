import OS from './lib.js';

const os = new OS(document.getElementById('terminal'));

os.line('Welcome to swagOS2 ===', "===");
os.commandLine();
os.sendCommand("colortest");
//os.sendCommand("service logs")
//os.sendCommand("? help -v")
// os.sendCommand('p c/u | lc')
// os.sendCommand("p c/u | service logs | service logs")
// os.sendCommand("service logs | p c/u | service logs")