import { spawn } from 'node:child_process';

const envFile = process.argv[2];

if (!envFile) {
  console.error('Usage: node ./scripts/run-with-env-file.mjs <env-file-path>');
  process.exit(1);
}

const child = spawn('npm run dev', {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ENV_FILE: envFile,
  },
});

child.on('error', (error) => {
  console.error(`Failed to start dev server: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
