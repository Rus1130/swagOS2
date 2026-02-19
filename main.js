import OS from './lib.js';

const os = new OS(document.getElementById('terminal'));

os.line('Welcome to swagOS 2.0!');
os.line('test', 'test');
os.line('test', "wat");
os.error('hi')
os.commandLine();