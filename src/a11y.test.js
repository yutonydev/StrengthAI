import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The linter cannot do this: jsx-a11y/control-has-associated-label catches
// <button></button> but passes <button><Trash2 /></button>, because a capitalised
// component might render text. Every icon-only control here is that shape.

const SRC = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

/** Every component source file, as [relativePath, contents]. */
function componentFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.name.endsWith('.jsx') && !entry.name.includes('.test.')) {
        out.push([rel, readFileSync(full, 'utf-8')]);
      }
    }
  };
  walk(SRC, '');
  return out;
}

// Counts nested <button> rather than lazy-matching a pair, which reported buttons
// that merely contain an icon as empty.
// indexOf('>') is wrong: onClick={() => x} contains a > inside the arrow function,
// which ended the tag mid-attribute and hid 17 of 23 offenders.
function endOfOpenTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      return i;
    }
  }
  return -1;
}

function buttonsIn(source) {
  const found = [];
  const openTag = /<button\b/g;
  let match;
  while ((match = openTag.exec(source))) {
    const start = match.index;
    const tagEnd = endOfOpenTag(source, start);
    if (tagEnd === -1) continue;
    const open = source.slice(start, tagEnd + 1);
    if (open.endsWith('/>')) {
      found.push({ open, inner: '', line: source.slice(0, start).split('\n').length });
      continue;
    }
    let depth = 1;
    let i = tagEnd + 1;
    while (i < source.length && depth > 0) {
      const nextOpen = source.indexOf('<button', i);
      const nextClose = source.indexOf('</button>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 7;
      } else {
        depth -= 1;
        i = nextClose + 9;
      }
    }
    found.push({
      open,
      inner: source.slice(tagEnd + 1, i - 9),
      line: source.slice(0, start).split('\n').length,
    });
  }
  return found;
}

// Expressions count as text: {startTitle} renders a label. Attribute expressions are
// removed with their tag on the next line.
function hasVisibleText(inner) {
  const text = inner
    // Expressions become a marker rather than being blanked: `{startTitle}` renders a
    // label, so a button containing one is labelled. Blanking them reported Home's
    // "Start workout" as unlabelled — a false alarm on a button with a visible name.
    // Attribute expressions are unaffected: the marker sits inside `<div className=…>`
    // and is removed with the tag on the next line.
    .replace(/\{[^{}]*\}/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}

const labelled = (open) => /aria-label(?:ledby)?\s*=/.test(open);

describe('every interactive control has an accessible name', () => {
  const offenders = [];
  for (const [file, source] of componentFiles()) {
    for (const { open, inner, line } of buttonsIn(source)) {
      if (!hasVisibleText(inner) && !labelled(open)) {
        const icon = inner.match(/<([A-Z]\w+)/);
        offenders.push(`${file}:${line} <button> containing only <${icon ? icon[1] : '?'} />`);
      }
    }
  }

  it('no icon-only button is missing aria-label', () => {
    expect(
      offenders,
      'These announce as just "button" to a screen reader. Add aria-label describing the ' +
        'ACTION, not the icon — "Delete set 3", not "trash icon".\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });
});

describe('the guard itself works', () => {
  // A scanner that silently matches nothing would pass forever and protect nothing.
  it('finds buttons at all', () => {
    const total = componentFiles().reduce((n, [, s]) => n + buttonsIn(s).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it('flags an unlabelled icon button', () => {
    const [{ open, inner }] = buttonsIn('<button onClick={x}><Trash2 /></button>');
    expect(hasVisibleText(inner)).toBe(false);
    expect(labelled(open)).toBe(false);
  });

  it('accepts a labelled icon button', () => {
    const [{ open }] = buttonsIn('<button aria-label="Delete set"><Trash2 /></button>');
    expect(labelled(open)).toBe(true);
  });

  it('accepts a button with real text, even when it also contains an icon', () => {
    // The nesting-aware scan exists for this case; a lazy regex reports it as empty.
    const [{ inner }] = buttonsIn('<button><Play />Start workout</button>');
    expect(hasVisibleText(inner)).toBe(true);
  });

  it('accepts a label supplied by an expression', () => {
    // Home's start button is `<div>{startTitle}</div>` beside an icon. Real label.
    const [{ inner }] = buttonsIn('<button><div className="x">{startTitle}</div><Play /></button>');
    expect(hasVisibleText(inner)).toBe(true);
  });

  it('still flags an icon button whose only expression is an attribute', () => {
    const [{ inner }] = buttonsIn('<button><Trash2 className={cls} /></button>');
    expect(hasVisibleText(inner)).toBe(false);
  });

  it('does not end the opening tag on a > inside an arrow function', () => {
    // The exact shape that hid Home's settings gear from this guard.
    const [{ open, inner }] = buttonsIn(
      `<button onClick={() => navigate('/settings')} className="x"><Settings /></button>`
    );
    expect(open).toContain('className="x"');
    expect(hasVisibleText(inner)).toBe(false);
  });

  it('treats a nested button pair correctly', () => {
    const found = buttonsIn('<button><span/><button aria-label="x"><X/></button>go</button>');
    expect(found).toHaveLength(2);
    expect(hasVisibleText(found[0].inner)).toBe(true);
  });
});
