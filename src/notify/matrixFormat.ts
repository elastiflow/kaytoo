import DOMPurify from 'isomorphic-dompurify';
import { compile } from 'html-to-text';
import { parse } from 'marked';

const htmlToPlain = compile({ wordwrap: false });

export function matrixMessageBodies(text: string): { plain: string; html: string } {
  const src = text.trim();
  if (!src) return { plain: '', html: '' };
  const raw = parse(src, { breaks: true }) as string;
  const html = DOMPurify.sanitize(raw);
  const plain = htmlToPlain(html).trim();
  return { plain: plain || src, html };
}
