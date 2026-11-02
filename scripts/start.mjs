// Keep npm start portable: shell-style NODE_ENV=... assignments fail on Windows.
process.env.NODE_ENV = 'production';
await import('../server/index.mjs');
