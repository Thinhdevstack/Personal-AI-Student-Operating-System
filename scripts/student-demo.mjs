// Windows-compatible entry point. Dynamic import lets server/env.mjs apply demo settings before providers initialize.
process.env.OFFICE_STUDENT_DEMO = '1';
process.env.NODE_ENV = process.argv.includes('--dev') ? 'development' : 'production';
process.env.OFFICE_PORT ||= '4311';
process.env.OFFICE_DIST_DIR ||= process.argv.includes('--dev') ? '.next-student-demo-dev' : '.next-student-demo';
await import('../server/index.mjs');
