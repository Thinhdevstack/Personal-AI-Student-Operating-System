process.env.OFFICE_STUDENT_LOCAL = '1';
process.env.OFFICE_STUDENT_DEMO = '0';
process.env.NODE_ENV = process.argv.includes('--dev') ? 'development' : 'production';
process.env.OFFICE_PORT ||= '4312';
// The server-rendered shell supports both modes; share the existing production build.
process.env.OFFICE_DIST_DIR ||= process.argv.includes('--dev') ? '.next-student-local-dev' : '.next-student-demo';
await import('../server/index.mjs');
