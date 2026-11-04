// Evaluate before AI modules: the custom HTTP server starts before Next.prepare().
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.argv.includes('--dev'), { info() {}, error() { throw new Error('Could not load local environment files'); } });
