// Runs the API (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'server'],
  ['web', 'client'],
].map(([name, dir]) => {
  const p = spawn('npm', ['run', 'dev'], { cwd: dir, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const tag = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (c) => process.stdout.write(tag(c)));
  p.stderr.on('data', (c) => process.stderr.write(tag(c)));
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown();
  });
  return p;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill();
  process.exit();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
