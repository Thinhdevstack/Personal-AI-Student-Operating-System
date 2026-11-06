// Evaluate before AI modules: the custom HTTP server starts before Next.prepare().
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { configureStudentDemo } from './student/demo-config.mjs';
import { configureStudentLocal } from './student/local-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, process.argv.includes('--dev'), { info() {}, error() { throw new Error('Could not load local environment files'); } });
configureStudentDemo(process.env, root);
configureStudentLocal(process.env);
