import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const isWindows = process.platform === 'win32';
const viteBin = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const nodeCmd = process.execPath;
const viteArgs = [viteBin, '--port=3001', '--host=0.0.0.0'];
const replicationArgs = [path.resolve(process.cwd(), 'scripts', 'replicationServer.mjs')];
const composeFile = path.resolve(process.cwd(), 'docker-compose.neo4j-chroma.yml');
const composeEnv = path.resolve(process.cwd(), '.env.neo4j-chroma');
const composeEnvSample = path.resolve(process.cwd(), '.env.neo4j-chroma.example');

let viteChild = null;
let replicationChild = null;
let shuttingDown = false;
let restartingVite = false;
let restartingReplication = false;

function log(msg) {
  process.stdout.write(`\n[dev-full] ${msg}\n`);
}

function printHelp() {
  process.stdout.write('\n[dev-full] Commandes: q = quitter, r = redemarrer Vite, p = redemarrer replication\n');
}

function parseSimpleEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const out = {};
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function ensureDockerStack() {
  if (!fs.existsSync(composeFile)) {
    throw new Error(`Compose file missing: ${composeFile}`);
  }
  if (!fs.existsSync(composeEnv)) {
    log('Fichier .env.neo4j-chroma absent, copie de .env.neo4j-chroma.example...');
    if (!fs.existsSync(composeEnvSample)) {
      throw new Error(`Missing env sample: ${composeEnvSample}`);
    }
    fs.copyFileSync(composeEnvSample, composeEnv);
  }
  log('Demarrage Neo4j + Chroma via Docker...');
  await runCommand('docker', ['compose', '--env-file', composeEnv, '-f', composeFile, 'up', '-d']);
}

function startVite() {
  viteChild = spawn(nodeCmd, viteArgs, { stdio: 'inherit', shell: false });
  viteChild.on('exit', (code, signal) => {
    viteChild = null;
    if (shuttingDown) return;
    if (restartingVite) {
      restartingVite = false;
      startVite();
      return;
    }
    log(`Vite arrete (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
  });
}

function startReplication() {
  const envFromCompose = parseSimpleEnvFile(composeEnv);
  const mergedEnv = {
    ...process.env,
    ...envFromCompose,
    // Keep explicit control if user exports one value at runtime.
    NEO4J_AUTH: process.env.NEO4J_AUTH || envFromCompose.NEO4J_AUTH || 'neo4j/socrate_dev_password',
    REPLICATION_SERVER_PORT: process.env.REPLICATION_SERVER_PORT || '3213',
  };
  replicationChild = spawn(nodeCmd, replicationArgs, {
    stdio: 'inherit',
    shell: false,
    env: mergedEnv,
  });
  replicationChild.on('exit', (code, signal) => {
    replicationChild = null;
    if (shuttingDown) return;
    if (restartingReplication) {
      restartingReplication = false;
      startReplication();
      return;
    }
    log(`Replication server arrete (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
  });
}

function stopChild(child) {
  if (!child?.pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
  } else {
    child.kill('SIGTERM');
  }
}

function requestRestartVite() {
  if (!viteChild) {
    startVite();
    return;
  }
  restartingVite = true;
  stopChild(viteChild);
}

function requestRestartReplication() {
  if (!replicationChild) {
    startReplication();
    return;
  }
  restartingReplication = true;
  stopChild(replicationChild);
}

async function requestShutdown() {
  shuttingDown = true;
  restartingVite = false;
  restartingReplication = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  stopChild(viteChild);
  stopChild(replicationChild);
  setTimeout(() => process.exit(0), 350);
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
      log('Redemarrage Vite...');
      requestRestartVite();
      return;
    }
    if (key === 'p') {
      log('Redemarrage replication server...');
      requestRestartReplication();
      return;
    }
  });
}

async function main() {
  printHelp();
  setupInput();
  try {
    await ensureDockerStack();
  } catch (error) {
    log(`Impossible de demarrer Docker stack: ${String(error?.message || error)}`);
    log('Demarrage app + replication sans auto-Docker.');
  }
  startReplication();
  startVite();
}

main().catch((error) => {
  log(`Erreur fatale: ${String(error?.message || error)}`);
  process.exit(1);
});
