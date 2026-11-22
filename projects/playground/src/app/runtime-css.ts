import { Component, InjectionToken, computed, inject, input } from '@angular/core';
import type { Signal, Type } from '@angular/core';
import type { PopoutWrapper } from 'angular-dockable-desktop';

/**
 * `?rc=1` (the M19 gate, 1.12.0): a tiny stand-in for a runtime CSS-in-JS library (Emotion with
 * `speedy`, as in production; styled-components; vanilla-extract's runtime): one cache per
 * document, each inserting its rules with `sheet.insertRule` into a `<style>` of that document's
 * `<head>`. The `<style>` element has no text, so a pop-out's head copy carries it empty: without
 * the app's `popoutWrapper` handing the cache the pop-out's document, what is styled this way is
 * unstyled there. That is the production failure rdd's Emotion test caught (an MUI SvgIcon 0 x 0).
 */

/** The document the content is rendered in, as the wrapper says; the page's without one. */
export const STYLE_DOCUMENT = new InjectionToken<Signal<Document>>('rc-document');

const caches = new WeakMap<Document, { sheet: CSSStyleSheet; inserted: Set<string> }>();

/** Inserts `.name { rules }` into `doc`'s own cache, once; returns the class name. */
export function rcClass(doc: Document, name: string, rules: string): string {
  let cache = caches.get(doc);
  if (!cache) {
    const style = doc.createElement('style');
    style.setAttribute('data-rc', '');
    doc.head.appendChild(style);
    cache = { sheet: style.sheet!, inserted: new Set() };
    caches.set(doc, cache);
  }
  const cls = `rc-${name}`;
  if (!cache.inserted.has(cls)) {
    cache.sheet.insertRule(`.${cls} { ${rules} }`, cache.sheet.cssRules.length);
    cache.inserted.add(cls);
  }
  return cls;
}

/** The class for `rules`, inserted into the document the wrapper gives (or the page's). Call in an injection context. */
export function injectRcClass(name: string, rules: string): Signal<string> {
  const doc = inject(STYLE_DOCUMENT, { optional: true });
  return computed(() => rcClass(doc?.() ?? document, name, rules));
}

const icons = new Map<string, Type<unknown>>();
/** An icon whose size and colour come only from the cache, as an MUI SvgIcon's do. Its own rule each. */
export function rcIcon(name: string): Type<unknown> {
  let type = icons.get(name);
  if (!type) {
    @Component({
      selector: 'pg-rc-icon',
      template: `<span [attr.data-rc-icon]="name" [class]="cls()"></span>`,
    })
    class RcIcon {
      protected readonly name = name;
      protected readonly cls = injectRcClass(`icon-${name}`, 'display: inline-block; width: 16px; height: 16px; background-color: rgb(200, 30, 40);');
    }
    type = RcIcon;
    icons.set(name, type);
  }
  return type;
}

/**
 * The app's `popoutWrapper` for the stand-in: hands its cache the document of what it is around,
 * as an app's CacheProvider would.
 */
@Component({
  selector: 'pg-rc-wrapper',
  template: '<ng-content />',
  providers: [{ provide: STYLE_DOCUMENT, useFactory: () => inject(RcWrapper).document }],
})
export class RcWrapper implements PopoutWrapper {
  readonly window = input.required<Window>();
  readonly document = input.required<Document>();
}
