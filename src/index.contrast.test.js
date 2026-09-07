import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fails the build if any text token drops below WCAG AA (4.5:1) on any surface, or a
// non-text mark below 3:1. Values are parsed from index.css so they cannot drift.

const css = readFileSync(
  fileURLToPath(new URL('./index.css', import.meta.url)),
  'utf-8'
);

// Hex only, first occurrence wins: index.css also has a leftover shadcn oklch block.
const tokens = {};
for (const [, name, hex] of css.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
  if (!(name in tokens)) tokens[name] = hex;
}

/** WCAG relative luminance. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio, always >= 1, order-independent. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Every component source, comments stripped so a retired colour named in a comment
// does not read as a violation.
function sourceFiles() {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const out = [];
  const walk = (d, prefix) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = `${d}/${entry.name}`;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (/\.(jsx?|css)$/.test(entry.name) && !entry.name.includes('.test.'))
        // Comments stripped: naming a retired colour while explaining why it went is
        // exactly what a comment should do, and must not read as a violation.
        out.push([
          rel,
          readFileSync(full, 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        ]);
    }
  };
  walk(dir.replace(/\/$/, ''), '');
  return out;
}

/** Every ground that text can land on in this app. */
const SURFACES = ['background', 'card', 'accent', 'sheet'];

/** Tokens rendered as text somewhere in src/. */
const TEXT_TOKENS = ['foreground', 'muted-foreground', 'primary', 'destructive'];

describe('palette tokens are parsed from the real stylesheet', () => {
  it('found every token the rest of this file asserts on', () => {
    for (const name of [...SURFACES, ...TEXT_TOKENS, 'muted-graphic', 'primary-foreground']) {
      expect(tokens[name], `--${name} is missing from index.css`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('did not pick up the leftover oklch block', () => {
    // Those are a different palette entirely; if one leaked in, every number below is wrong.
    expect(tokens.background).toBe('#101211');
    expect(tokens.foreground).toBe('#ECEFEA');
  });
});

describe('text meets WCAG AA (4.5:1) on every surface', () => {
  for (const text of TEXT_TOKENS) {
    for (const surface of SURFACES) {
      it(`--${text} on --${surface}`, () => {
        const ratio = contrast(tokens[text], tokens[surface]);
        expect(
          ratio,
          `--${text} (${tokens[text]}) on --${surface} (${tokens[surface]}) is ` +
            `${ratio.toFixed(2)}:1, below the 4.5:1 AA minimum for normal text`
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('non-text marks meet WCAG AA (3:1) on every surface', () => {
  for (const surface of SURFACES) {
    it(`--muted-graphic on --${surface}`, () => {
      const ratio = contrast(tokens['muted-graphic'], tokens[surface]);
      expect(
        ratio,
        `--muted-graphic (${tokens['muted-graphic']}) on --${surface} ` +
          `(${tokens[surface]}) is ${ratio.toFixed(2)}:1, below the 3:1 minimum`
      ).toBeGreaterThanOrEqual(3);
    });
  }

  it('is dimmer than muted-foreground, or it has no reason to exist', () => {
    // The point of a separate graphic grey is a visible step below text. If they converge,
    // delete this token and use muted-foreground everywhere instead.
    expect(luminance(tokens['muted-graphic'])).toBeLessThan(luminance(tokens['muted-foreground']));
  });

  it('is not used as a text colour anywhere in src/', () => {
    // It only clears the 3:1 graphics bar, so `text-muted-graphic` would be a contrast
    // violation that the token checks above cannot see — they test values, not usage.
    // `fill-` and `stroke-` are the legitimate uses and are deliberately not matched.
    const offenders = sourceFiles()
      .filter(([, text]) => /text-muted-graphic/.test(text))
      .map(([file]) => file);
    expect(
      offenders,
      `--muted-graphic is for icons and chart marks only (3:1). Use text-muted-foreground ` +
        `for text. Found text-muted-graphic in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

describe('text on filled controls', () => {
  it('--primary-foreground on --primary', () => {
    const ratio = contrast(tokens['primary-foreground'], tokens.primary);
    expect(ratio, `${ratio.toFixed(2)}:1 on the filled accent button`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the colour this replaced does not come back', () => {
  // Comments are stripped first: naming the old value while explaining why it went is
  // exactly what the comments in index.css should do. Only live declarations count.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('no token is set to #5F665F', () => {
    // 2.72:1 at worst. It failed the text bar and the graphics bar simultaneously.
    expect(withoutComments).not.toMatch(/#5F665F/i);
  });

  it('#5F665F is gone from every component too', () => {
    // The stylesheet is only half of it — the value lived as a raw literal in 29 places
    // across 14 files, which is why it was never noticed. A token nobody uses is no fix.
    const offenders = sourceFiles()
      .filter(([, text]) => /#5F665F/i.test(text))
      .map(([file]) => file);
    expect(
      offenders,
      `#5F665F fails WCAG on every surface in this app. Use text-muted-foreground for ` +
        `text or muted-graphic for icons. Still present in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
