import { describe, it, expect } from 'vitest';

// Every screen imports cleanly and exports a component. Renders nothing — it catches the
// failure the pure-logic tests cannot: a screen that no longer *loads*. A renamed export or
// a circular import leaves the lib tests green while the app shows a blank page, and since
// the routes went lazy that fails at navigation instead of at build time.
const PAGES = {
  Home: () => import('./Home.jsx'),
  Login: () => import('./Login.jsx'),
  Register: () => import('./Register.jsx'),
  ForgotPassword: () => import('./ForgotPassword.jsx'),
  ResetPassword: () => import('./ResetPassword.jsx'),
  Workout: () => import('./Workout.jsx'),
  Progress: () => import('./Progress.jsx'),
  Coach: () => import('./Coach.jsx'),
  CoachChat: () => import('./CoachChat.jsx'),
  SessionDetail: () => import('./SessionDetail.jsx'),
  Settings: () => import('./Settings.jsx'),
  Templates: () => import('./Templates.jsx'),
  TemplateEditor: () => import('./TemplateEditor.jsx'),
};

describe('every page module loads', () => {
  for (const [name, load] of Object.entries(PAGES)) {
    it(`${name} imports and has a default export`, async () => {
      const mod = await load();
      expect(typeof mod.default).toBe('function');
    });
  }
});

describe('shared modules load', () => {
  const SHARED = {
    App: () => import('../App.jsx'),
    AppLayout: () => import('../components/AppLayout.jsx'),
    ScreenState: () => import('../components/ScreenState.jsx'),
    useExerciseOrder: () => import('../hooks/useExerciseOrder.js'),
    useVariantMap: () => import('../hooks/useVariantMap.js'),
    localState: () => import('../lib/localState.js'),
    bodyParts: () => import('../lib/bodyParts.js'),
  };

  for (const [name, load] of Object.entries(SHARED)) {
    it(`${name} imports`, async () => {
      await expect(load()).resolves.toBeTruthy();
    });
  }
});
