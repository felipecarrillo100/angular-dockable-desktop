import { Component, ElementRef, inject, input } from '@angular/core';
import type { OnInit } from '@angular/core';

/**
 * An iframe that counts its loads, for the M11 gate (7.11, `preserveEmbeds`): a move that
 * re-inserts it reloads it, which fires `load` again. Counted by `name` in `window.__embedLoads`.
 * Used as a panel (the name comes from the panel's inputs) and as a managed widget's content.
 * vdd's `EmbedFrame.vue`. Created imperatively: Angular refuses a bound `srcdoc` (NG0910).
 */
@Component({ selector: 'pg-embed-frame', host: { style: 'display: block; width: 100%; height: 100%' }, template: '' })
export class EmbedFrame implements OnInit {
  readonly name = input('embed');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  ngOnInit(): void {
    const name = this.name();
    const loads = ((window as unknown as { __embedLoads?: Record<string, number> }).__embedLoads ??= {});
    const frame = document.createElement('iframe');
    frame.setAttribute('data-embed', name);
    frame.title = name;
    frame.style.cssText = 'width: 100%; height: 100%; border: 0; display: block';
    frame.addEventListener('load', () => (loads[name] = (loads[name] ?? 0) + 1));
    frame.srcdoc = `<p>${name}</p>`;
    this.host.appendChild(frame);
  }
}
