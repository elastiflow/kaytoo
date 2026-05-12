import { describe, expect, it } from 'vitest';
import { matrixMessageBodies } from '../src/notify/matrixFormat.js';

describe('matrixMessageBodies', () => {
  it('renders GFM to HTML and readable plain', () => {
    const { plain, html } = matrixMessageBodies('## Top\n\n**bold** and `x`.\n\n- a\n- b\n');
    expect(html).toMatch(/<h2[^>]*>Top/);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>x</code>');
    expect(html).toContain('<ul>');
    expect(plain).toMatch(/bold/i);
    expect(plain).toMatch(/a/i);
  });

  it('strips dangerous markup after parse', () => {
    const { html } = matrixMessageBodies('x<script>y</script>');
    expect(html.toLowerCase()).not.toContain('script');
  });

  it('treats blank input as empty', () => {
    expect(matrixMessageBodies('')).toEqual({ plain: '', html: '' });
    expect(matrixMessageBodies('  \n')).toEqual({ plain: '', html: '' });
  });

  it('decodes basic entities in plain fallback', () => {
    expect(matrixMessageBodies('AT&T').plain).toContain('AT&T');
  });
});
