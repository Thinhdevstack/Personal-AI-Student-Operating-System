import { spawnSync } from 'node:child_process';
const build = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit', env: { ...process.env, OFFICE_DIST_DIR: '.next-student-demo' },
});
process.exit(build.status ?? 1);
