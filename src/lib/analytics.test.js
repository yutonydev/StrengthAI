import { describe, it, expect } from 'vitest';
import { scrubAnalyticsEvent } from './analytics.js';

const scrub = (url, type = 'pageview') => scrubAnalyticsEvent({ type, url });
const ID = '827325b3-b7f3-44a2-8e09-6f1467d0f327';

describe('scrubAnalyticsEvent', () => {
  it('drops the recovery token Supabase puts in the reset link hash', () => {
    const out = scrub('https://strength-ai.vercel.app/reset#access_token=eyJhbGci&refresh_token=abc&type=recovery');
    expect(out.url).toBe('https://strength-ai.vercel.app/reset');
    expect(out.url).not.toMatch(/token/);
  });

  it('drops a PKCE code or any other query string', () => {
    expect(scrub('https://strength-ai.vercel.app/reset?code=secret123').url)
      .toBe('https://strength-ai.vercel.app/reset');
  });

  it('groups per-row pages by route', () => {
    expect(scrub(`https://strength-ai.vercel.app/workout/${ID}`).url)
      .toBe('https://strength-ai.vercel.app/workout/:id');
    expect(scrub(`https://strength-ai.vercel.app/session/${ID.toUpperCase()}`).url)
      .toBe('https://strength-ai.vercel.app/session/:id');
  });

  it('leaves ordinary routes alone', () => {
    expect(scrub('https://strength-ai.vercel.app/coach/insights').url)
      .toBe('https://strength-ai.vercel.app/coach/insights');
  });

  it('keeps the rest of the event intact', () => {
    const out = scrubAnalyticsEvent({ type: 'event', url: 'https://x.dev/a?b=1', name: 'n' });
    expect(out).toEqual({ type: 'event', url: 'https://x.dev/a', name: 'n' });
  });

  it('sends nothing when the url cannot be parsed', () => {
    expect(scrub('not a url#access_token=abc')).toBeNull();
  });
});
