import { spawn } from 'node:child_process';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const viteCmd = process.execPath;
const viteArgs = [viteBin, '--port=3001', '--host=0.0.0.0'];

let child = null;
let restarting = false;
let shuttingDown = false;

function printHelp() {
  process.stdout.write('\n[dev-runner] Commandes: q = quitter, r = redemarrer Vite\n');
}

function startVite() {
  child = spawn(viteCmd, viteArgs, {
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    if (restarting) {
      restarting = false;
      startVite();
      return;
    }
    if (code !== 0) {
      process.stdout.write(`\n[dev-runner] Vite arrete (code=${code ?? 'null'}, signal=${signal ?? 'null'}).\n`);
      process.stdout.write('[dev-runner] Appuyez sur r pour relancer, q pour quitter.\n');
    }
  });
}

function stopChild() {
  if (!child) return;
  const pid = child.pid;
  if (!pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: false });
    return;
  }
  child.kill('SIGTERM');
}

function requestRestart() {
  if (!child) {
    startVite();
    return;
  }
  restarting = true;
  stopChild();
}

function requestShutdown() {
  shuttingDown = true;
  restarting = false;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  if (!child) {
    process.exit(0);
    return;
  }
  stopChild();
  setTimeout(() => process.exit(0), 300);
}

function setupInput() {
  if (!process.stdin.isTTY) return;
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    const key = String(chunk || '').toLowerCase();
    if (key === '\u0003' || key === 'q') {
      requestShutdown();
      return;
    }
    if (key === 'r') {
      process.stdout.write('\n[dev-runner] Redemarrage demande...\n');
      requestRestart();
      return;
    }
  });
}

printHelp();
setupInput();
startVite();
