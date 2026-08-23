import { describe, it, expect } from 'vitest';

/**
 * Every screen imports cleanly and exports a component.
 *
 * This does not render anything — there is no DOM here and these tests stay dependency-free
 * on purpose (see CLAUDE.md). What it catches is the failure mode the other 85 tests cannot:
 * a screen that no longer *loads*. A renamed export, a deleted helper still being imported, a
 * circular import, a constant moved to another module — none of those touch pure logic, so
 * the lib tests stay green while the app shows a blank page.
 *
 * That gap became real when the routes went lazy: a broken import used to fail the build,
 * and now it fails at navigation instead, on whichever screen the lifter happens to open.
 */
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
