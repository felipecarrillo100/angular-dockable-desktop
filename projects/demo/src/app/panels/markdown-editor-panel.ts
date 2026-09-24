import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import * as monaco from 'monaco-editor';
import { injectColorScheme, injectPanelContribution, startPointerDrag } from 'angular-dockable-desktop';
import type { ToolbarItem } from 'angular-dockable-desktop';
import { monacoEditor } from '../monaco';
import { markdownOf } from '../markdown';
import type { Heading } from '../markdown';

const DEFAULT_MARKDOWN = `# Getting started

Welcome to the **markdown editor** panel. Edit the source on the left; the preview renders
live on the right — drag the divider between them.

## What this demonstrates

- A live preview through a \`unified\` pipeline
- GitHub-flavoured tables and task lists, via \`remark-gfm\`
- A table of contents contributed to the app's sidebar *while this panel is active*
- Six formatting actions contributed to the app's toolbar
- Maths, via \`remark-math\` and \`rehype-katex\`: $E = mc^2$
- Syntax highlighting, via \`rehype-highlight\`

## A table

| Capability | Where it lives |
| --- | --- |
| Zero-unmount panels | the library |
| Monaco's undo history | this panel |
| The divider you just dragged | \`startPointerDrag\`, exported |

## A task list

- [x] Port the pipeline unchanged
- [x] Keep the divider on the library's own primitive
- [ ] Notice that none of this is re-created

## Some code

\`\`\`ts
const workspace = inject(Workspace);
workspace.openPanel('notes', 'markdownEditor');
\`\`\`

> The editor keeps its cursor, selection and undo stack through every dock and float,
> because the panel's DOM is moved rather than re-created.

$$
\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;

/**
 * A table of contents, contributed to the application's sidebar. A contribution is data, so
 * the headings and the scroll action arrive as inputs and the shell decides where it goes.
 */
@Component({
  selector: 'dd-markdown-toc',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd-panel">
      @if (headings().length === 0) {
        <p class="dd-note">No headings yet.</p>
      } @else {
        <div class="dd-col">
          @for (heading of headings(); track heading.id) {
            <a
              [href]="'#' + heading.id"
              [attr.data-demo-toc]="heading.id"
              [style.padding-inline-start.rem]="(heading.depth - 1) * 0.7"
              [style.opacity]="1 - (heading.depth - 1) * 0.12"
              style="font-size: 0.76rem; cursor: pointer; text-decoration: none"
              (click)="$event.preventDefault(); select()(heading.id)"
            >{{ heading.text }}</a>
          }
        </div>
      }
    </div>
  `,
})
export class MarkdownToc {
  readonly headings = input<Heading[]>([]);
  readonly select = input<(id: string) => void>(() => undefined);
}

/**
 * A split markdown editor: Monaco on one side, a live preview on the other, with a divider
 * built on the library's own exported drag primitive.
 *
 * Four things worth noticing:
 *
 *  - **`startPointerDrag` is public.** The divider uses exactly the mechanic the library uses
 *    for its own window edges and grid splits, including releasing pointer capture on cancel.
 *  - **It contributes to the application's chrome.** Six formatting actions appear in the
 *    app's toolbar and a table of contents in its sidebar, but only while this panel is the
 *    active one. The shell knows nothing about markdown.
 *  - **The pipeline is `unified`, unchanged from rdd's and vdd's demos.**
 *  - **The editor survives everything.** Dock this panel, float it, minimise it: Monaco keeps
 *    its undo history and its cursor, and the preview keeps its scroll position.
 */
@Component({
  selector: 'dd-markdown-editor-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #container class="dd-panel dd-panel--flush" style="display: flex; position: relative">
      <div #editorHost class="dd-monaco" data-demo-md-editor [style.flex]="'0 0 ' + ratio() * 100 + '%'" style="min-width: 0"></div>
      <div
        class="ndd-resizer-bar"
        [class.ndd-active]="dragging()"
        data-demo-md-divider
        style="flex: 0 0 4px; cursor: col-resize; align-self: stretch"
        (pointerdown)="onDividerDown($event)"
      ></div>
      <div #preview class="dd-markdown" data-demo-md-preview style="flex: 1; min-width: 0; overflow: auto" [innerHTML]="html()"></div>
    </div>
  `,
})
export class MarkdownEditorPanel {
  protected readonly source = signal(DEFAULT_MARKDOWN);
  protected readonly ratio = signal(0.5);
  protected readonly dragging = signal(false);
  protected readonly markdown = markdownOf(this.source);
  /**
   * Trusted explicitly. Angular's sanitiser would strip KaTeX's inline styles and its MathML,
   * and the source is text the user typed into this panel — the same trust vdd's `v-html` and
   * rdd's renderer give it. An application rendering *someone else's* markdown should add
   * `rehype-sanitize` to the pipeline instead.
   */
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.markdown.html()));
  private readonly container = viewChild.required<ElementRef<HTMLElement>>('container');
  private readonly editorHost = viewChild<ElementRef<HTMLElement>>('editorHost');
  private readonly preview = viewChild.required<ElementRef<HTMLElement>>('preview');
  private readonly editor: ReturnType<typeof monacoEditor>;

  constructor() {
    const scheme = injectColorScheme();
    const theme = computed(() => (scheme() === 'light' ? 'vs' : 'vs-dark'));
    this.editor = monacoEditor(this.editorHost, this.source, { language: 'markdown', theme });

    const glyph = (name: string) => `dd-glyph dd-glyph-${name}`;
    const actions: ToolbarItem[] = [
      { type: 'action', id: 'md-bold', label: 'Bold', icon: glyph('bold'), onClick: () => this.wrapSelection('**') },
      { type: 'action', id: 'md-italic', label: 'Italic', icon: glyph('italic'), onClick: () => this.wrapSelection('*') },
      { type: 'action', id: 'md-code', label: 'Inline code', icon: glyph('code'), onClick: () => this.wrapSelection('`') },
      { type: 'separator' },
      { type: 'action', id: 'md-h1', label: 'Heading 1', icon: glyph('h1'), onClick: () => this.prefixLines('# ') },
      { type: 'action', id: 'md-h2', label: 'Heading 2', icon: glyph('h2'), onClick: () => this.prefixLines('## ') },
      { type: 'action', id: 'md-list', label: 'Bullet list', icon: glyph('list'), onClick: () => this.prefixLines('- ') },
    ];
    const select = (id: string) => this.scrollTo(id);

    // A getter, so the table of contents re-publishes as the document's headings change.
    injectPanelContribution(() => ({
      toolbarItems: actions,
      sidebarSections: [{ id: 'md-toc', label: 'Contents', icon: glyph('toc'), component: MarkdownToc, inputs: { headings: this.markdown.headings(), select } }],
    }));
  }

  /**
   * The divider tracks an absolute ratio of the container rather than a delta from where the
   * drag started, so the pointer's live position is recovered from the reported delta.
   */
  protected onDividerDown(event: PointerEvent): void {
    event.preventDefault();
    const rect = this.container().nativeElement.getBoundingClientRect();
    this.dragging.set(true);
    startPointerDrag({
      element: event.currentTarget as HTMLElement,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      captureStart: () => event.clientX,
      activeClasses: [{ el: document.body, classes: ['ndd-resizing-active', 'ndd-resizing-col-active'] }],
      onMove: (dx, _dy, startX) => this.ratio.set(Math.min(0.85, Math.max(0.15, (startX + dx - rect.left) / rect.width))),
      onEnd: () => this.dragging.set(false),
    });
  }

  private wrapSelection(before: string, after = before): void {
    const instance = this.editor();
    const selection = instance?.getSelection();
    const model = instance?.getModel();
    if (!instance || !selection || !model) return;
    const selected = model.getValueInRange(selection).trim() || 'text';
    instance.executeEdits('format', [{ range: selection, text: `${before}${selected}${after}` }]);
    instance.focus();
  }

  private prefixLines(prefix: string): void {
    const instance = this.editor();
    const selection = instance?.getSelection();
    if (!instance || !selection) return;
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    for (let line = selection.startLineNumber; line <= selection.endLineNumber; line++) edits.push({ range: new monaco.Range(line, 1, line, 1), text: prefix });
    instance.executeEdits('format', edits);
    instance.focus();
  }

  private scrollTo(id: string): void {
    this.preview().nativeElement.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
