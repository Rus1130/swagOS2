import OS from './lib.js';

const os = new OS(document.getElementById('terminal'));

os.line('Welcome to swagOS2 ===', "===");
os.commandLine();
os.sendCommand("ls -r")
//os.sendCommand("ls -r=1")
os.sendCommand("v doc/i/t/p.img")
//os.sendCommand("ef c/u")
// os.sendCommand("service logs")
//os.sendCommand("p doc/i/t/s.img")
// os.sendCommand("service logs")
//os.sendCommand("bgt start")
//os.sendCommand("cls | ef w")
//os.sendCommand("? help -v")
// os.sendCommand('p c/u | lc')
// os.sendCommand("p c/u | service logs | service logs")
// os.sendCommand("service logs | p c/u | service logs")