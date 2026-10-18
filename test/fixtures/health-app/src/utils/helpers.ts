/**
 * Grab-bag of helpers (deliberately a "god file" for the health fixture).
 */

export function formatMoney(value: number): string {
  const fixed = value.toFixed(2);
  if (value < 0) {
    return `-$${fixed.slice(1)}`;
  }
  return `$${fixed}`;
}

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${m < 10 ? `0${m}` : m}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) {
    return lo;
  }
  if (n > hi) {
    return hi;
  }
  return n;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function helper01(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper02(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper03(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper04(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper05(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper06(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper07(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper08(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper09(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper10(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper11(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper12(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper13(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper14(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper15(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper16(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper17(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper18(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper19(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper20(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper21(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper22(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper23(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function helper24(input: string, mode: number): string {
  let out = input;
  if (mode > 1) {
    out = out.trim();
  } else if (mode < 0) {
    out = out.toUpperCase();
  }
  for (let i = 0; i < mode; i++) {
    if (out.length > 10) {
      out = out.slice(1);
    }
  }
  return out;
}

export function parseConfig(text: string, strict: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      continue;
    }
    const [key, value] = line.split('=');
    if (key && value) {
      if (strict && key.includes(' ')) {
        throw new Error(`bad key ${key}`);
      } else if (value.startsWith('"')) {
        out[key] = value.slice(1, -1);
      } else {
        out[key] = value;
      }
    } else if (strict) {
      if (line.trim().length > 0) {
        throw new Error('bad line');
      }
    }
  }
  return out;
}
