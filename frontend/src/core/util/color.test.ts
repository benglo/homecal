import { describe, it, expect } from 'vitest';
import { contrastRatio, fgForBg, isHex6 } from './color';

describe('isHex6', () => {
  it('accepts #RRGGBB only', () => {
    expect(isHex6('#0072b2')).toBe(true);
    expect(isHex6('#FFF')).toBe(false);
    expect(isHex6('0072b2')).toBe(false);
    expect(isHex6('#0072b2 ')).toBe(true); // trimmed
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('returns null for an invalid hex', () => {
    expect(contrastRatio('nope', '#ffffff')).toBeNull();
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0072b2', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0072b2')!, 6);
  });
});

describe('fgForBg', () => {
  it('picks white text on dark, black on light', () => {
    expect(fgForBg('#0072b2')).toBe('#ffffff');
    expect(fgForBg('#f0e442')).toBe('#000000');
  });
});
