// CI runners have no GPU. Select Chromium's bundled software renderer explicitly instead of relying on fallback.
// These flags affect the isolated test browser only, not the user's browser or the application.
export const browserOptions = {
  ...(process.env.CI && { launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] } }),
  trace: 'retain-on-failure' as const,
  screenshot: 'only-on-failure' as const,
};

// Cold software-renderer startup can approach 30s even with one worker. Keep business assertions at 30s.
export const officeStartTimeout = process.env.CI ? 60000 : 30000;
