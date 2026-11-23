/**
 * The app's `popoutWrapper` (`<ndd-desktop [popoutWrapper]>`, 1.12.0) around what the library
 * renders: rdd 7.12.0's `<Wrapper window document>{children}</Wrapper>`, vdd 1.14.0's
 * `VddPopoutWrap`. Internal.
 *
 * The Angular form: the wrapper is a component type with `window` and `document` inputs and an
 * `<ng-content />`. The library creates it (`createComponent`), projects its own element into it,
 * and gives what it renders inside the wrapper's injector as parent, so what the wrapper provides
 * (a style cache for its document, say) reaches that content's components: their icons, a menu
 * item's, a toast's, the panel's own. Its host carries `.ndd-popout-wrapper` (`display: contents`),
 * so a wrapper whose template is only `<ng-content />` adds no box.
 *
 * - {@link mountPopoutWrapper}: around a panel's content element, for its whole life (`PanelHost`);
 * - {@link NddPopoutWrap} (`*nddPopoutWrap="doc"`): around a template rendered in a pop-out's
 *   document: the frame, a context menu, a toast container. In the main document it renders the
 *   template as it is.
 */
import {
  ApplicationRef,
  Directive,
  EnvironmentInjector,
  Injector,
  TemplateRef,
  ViewContainerRef,
  createComponent,
  effect,
  inject,
  input,
  reflectComponentType,
  untracked,
} from '@angular/core';
import type { ComponentRef, EmbeddedViewRef, Type } from '@angular/core';
import { docOf } from '../core/dom-context';
import { popoutWrapperFor } from '../panel/panel-window';
import { NDD_PORTAL_INTO } from './portal';

/** A wrapper created around some content: its injector, for that content, and its teardown. */
export interface MountedPopoutWrapper {
  readonly ref: ComponentRef<unknown>;
  /** The wrapper's host (`.ndd-popout-wrapper`), not yet placed: the caller puts it where the content was. */
  readonly host: HTMLElement;
  /** The parent for the content's injectors: the wrapper's own, so what it provides reaches them. */
  readonly injector: Injector;
  /** Gives it a new window and document. */
  setWindow(win: Window, doc: Document): void;
  destroy(): void;
}

/**
 * Creates the app's wrapper `type` around `content` (projected into its `<ng-content />`), with
 * `win` and `doc` as its `window` and `document` inputs (set at once, so the content can read them
 * from its first line), attached to the application so it is checked with every render.
 */
export function mountPopoutWrapper(
  type: Type<unknown>,
  options: { content: Node[]; win: Window; doc: Document; parent: Injector; environment: EnvironmentInjector; appRef: ApplicationRef },
): MountedPopoutWrapper {
  const ref = createComponent(type, {
    environmentInjector: options.environment,
    elementInjector: options.parent,
    projectableNodes: [options.content],
  });
  const declared = new Set((reflectComponentType(type)?.inputs ?? []).map(i => i.templateName));
  let win: Window | null = null;
  let doc: Document | null = null;
  const setWindow = (nextWin: Window, nextDoc: Document) => {
    if (declared.has('window') && nextWin !== win) ref.setInput('window', nextWin);
    if (declared.has('document') && nextDoc !== doc) ref.setInput('document', nextDoc);
    win = nextWin;
    doc = nextDoc;
  };
  setWindow(options.win, options.doc);
  const host = ref.location.nativeElement as HTMLElement;
  host.classList.add('ndd-popout-wrapper');
  options.appRef.attachView(ref.hostView);
  return {
    ref,
    host,
    injector: ref.injector,
    setWindow,
    destroy: () => {
      options.appRef.detachView(ref.hostView);
      ref.destroy();
      host.remove();
    },
  };
}

/**
 * `*nddPopoutWrap="doc"`: renders its template inside the app's `popoutWrapper` for `doc`, a
 * pop-out's document (a document, or a node of one): the wrapper's host goes into that document's
 * `<body>`, the element projected into it takes the template's `[nddPortal]` elements, and the
 * template's injector is the wrapper's. With no wrapper (the main document, popOut off, none given)
 * the template renders as it is. `type` names the wrapper; left out, it is the one recorded for the
 * document (`popoutWrapperFor`), which is how a menu or toasts beside the desktop find it.
 *
 * A new document, or a new wrapper, renders the template afresh.
 * @internal
 */
@Directive({ selector: '[nddPopoutWrap]' })
export class NddPopoutWrap {
  readonly nddPopoutWrap = input<Document | Node | null | undefined>(null);
  /** The wrapper; undefined: the one recorded for the document; null: none. */
  readonly nddPopoutWrapType = input<Type<unknown> | null | undefined>(undefined);

  private readonly tpl = inject(TemplateRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly environment = inject(EnvironmentInjector);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(Injector);

  constructor() {
    effect(onCleanup => {
      const target = this.nddPopoutWrap();
      const doc = target ? docOf(target) : null;
      const given = this.nddPopoutWrapType();
      const type = given === undefined ? popoutWrapperFor(doc) : given;
      untracked(() => {
        const view = this.render(doc, type);
        onCleanup(view);
      });
    });
  }

  /** Renders the template, wrapped when there is a wrapper and a pop-out's window; returns its teardown. */
  private render(doc: Document | null, type: Type<unknown> | null): () => void {
    const win = doc?.defaultView ?? null;
    const main = typeof document === 'undefined' ? null : document;
    if (!type || !doc || !win || doc === main) {
      const view = this.vcr.createEmbeddedView(this.tpl);
      return () => this.drop(view);
    }
    const into = doc.createElement('div');
    into.className = 'ndd-popout-wrapper__content';
    const wrapper = mountPopoutWrapper(type, { content: [into], win, doc, parent: this.injector, environment: this.environment, appRef: this.appRef });
    doc.body.appendChild(wrapper.host);
    const injector = Injector.create({ providers: [{ provide: NDD_PORTAL_INTO, useValue: into }], parent: wrapper.injector });
    const view = this.vcr.createEmbeddedView(this.tpl, undefined, { injector });
    return () => {
      this.drop(view);
      wrapper.destroy();
    };
  }

  private drop(view: EmbeddedViewRef<unknown>): void {
    const at = this.vcr.indexOf(view);
    if (at !== -1) this.vcr.remove(at);
    else view.destroy();
  }
}
