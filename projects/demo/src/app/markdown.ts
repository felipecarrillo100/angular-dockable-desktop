import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Signal } from '@angular/core';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';

/**
 * Markdown to HTML, with the plugin set rdd's and vdd's demos use: `unified` plugins, not
 * framework components, so the pipeline ports unchanged and only the glue is Angular.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm) // tables, task lists, strikethrough
  .use(remarkMath) // $inline$ and $$block$$
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug) // heading ids, for the table of contents
  .use(rehypeKatex)
  .use(rehypeHighlight, { detect: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

export function renderMarkdown(source: string): string {
  return String(processor.processSync(source));
}

/** A heading in the rendered document, for a table of contents. */
export interface Heading {
  id: string;
  text: string;
  depth: number;
}

/**
 * Rendered HTML plus its headings, kept in step with `source` — debounced, because the demo
 * renders while the user types and the maths and highlighting passes are not free. Call in an
 * injection context; the timer is cleared with the caller.
 */
export function markdownOf(source: Signal<string>, debounceMs = 180): { html: Signal<string>; headings: Signal<Heading[]> } {
  const html = signal(renderMarkdown(untracked(source)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  effect(() => {
    const next = source();
    if (first) {
      first = false;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => html.set(renderMarkdown(next)), debounceMs);
  });
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));

  const headings = computed<Heading[]>(() => {
    const found: Heading[] = [];
    for (const m of html().matchAll(/<h([1-6])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
      found.push({ depth: Number(m[1]), id: m[2]!, text: m[3]!.replace(/<[^>]+>/g, '').trim() });
    }
    return found;
  });
  return { html: html.asReadonly(), headings };
}
