/**
 * Renders an {@link NddIcon}: a component, a `TemplateRef`, or a CSS class list.
 * @internal — the library's own chrome uses it wherever an icon appears.
 */
import { Component, TemplateRef, computed, input } from '@angular/core';
import type { Type } from '@angular/core';
import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import type { NddIcon } from '../core/icon';

@Component({
  selector: 'ndd-icon',
  imports: [NgComponentOutlet, NgTemplateOutlet],
  host: { class: 'ndd-icon', 'aria-hidden': 'true' },
  template: `
    @switch (kind()) {
      @case ('template') { <ng-container [ngTemplateOutlet]="asTemplate()" /> }
      @case ('component') { <ng-container [ngComponentOutlet]="asComponent()" /> }
      @case ('class') { <span [class]="icon()"></span> }
    }
  `,
})
export class NddIconView {
  readonly icon = input.required<NddIcon>();
  protected readonly kind = computed(() => {
    const icon = this.icon();
    return icon instanceof TemplateRef ? 'template' : typeof icon === 'string' ? 'class' : 'component';
  });
  protected readonly asTemplate = computed(() => this.icon() as TemplateRef<unknown>);
  protected readonly asComponent = computed(() => this.icon() as Type<unknown>);
}
