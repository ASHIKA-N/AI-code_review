// Exercises the compiled extension's Git service and API client against a real backend.
const { spawn, execFileSync } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { GitService } = require('../extension/dist/src/git');
const { ApiClient } = require('../extension/dist/src/api');

async function main() {
  const workspace = path.resolve(__dirname, '..');
  const python = path.join(workspace, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const root = await mkdtemp(path.join(tmpdir(), 'verireview-smoke-'));
  const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18764'], {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, APP_ENV: 'development', AI_PROVIDER: 'mock', VERIREVIEW_API_KEY: 'smoke-only-key' },
    stdio: 'pipe',
  });
  let startupError;
  server.on('error', error => { startupError = error; });
  server.stdout.resume();
  server.stderr.resume();
  const client = new ApiClient('http://127.0.0.1:18764', 'smoke-only-key');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw new Error('Smoke backend exited before startup; check port 18764.');
      try { await client.health(); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, 'Backend must start');
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'VeriReview smoke');
    git('config', 'user.email', 'smoke@example.invalid');
    await writeFile(path.join(root, 'payment.py'), 'value = 1\n');
    git('add', '.'); git('commit', '-m', 'baseline');
    await writeFile(path.join(root, 'payment.py'), 'value = 1\npassword = "demo-only"\n');
    const { request } = await new GitService(root).collect('working', '', 50);
    const result = await client.review(request, new AbortController().signal);
    assert.equal(result.provider, 'mock');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].file_path, 'payment.py');
    assert.equal(result.findings[0].start_line, 2);
    assert.equal(result.findings[0].source, 'mock');
    console.log('PASS: real Git diff -> extension API client -> FastAPI -> validated mock finding at payment.py:2');
  } finally {
    server.kill();
    // root is created above with mkdtemp and never derived from repository input.
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
