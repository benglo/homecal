import { describe, it, expect } from 'vitest';
import { volumeGlyph } from './VolumeControl';

describe('volumeGlyph', () => {
  it('shows muted when audio-muted regardless of level', () => {
    expect(volumeGlyph(80, true)).toBe('muted');
    expect(volumeGlyph(0, true)).toBe('muted');
  });

  it('shows muted at zero volume', () => {
    expect(volumeGlyph(0, false)).toBe('muted');
  });

  it('shows low below 50%', () => {
    expect(volumeGlyph(1, false)).toBe('low');
    expect(volumeGlyph(49, false)).toBe('low');
  });

  it('shows high at 50% and above', () => {
    expect(volumeGlyph(50, false)).toBe('high');
    expect(volumeGlyph(100, false)).toBe('high');
  });
});
