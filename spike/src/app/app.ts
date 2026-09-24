import {
  ApplicationRef, Component, ComponentRef, ElementRef, EnvironmentInjector, Injector,
  ViewContainerRef, afterRenderEffect, computed, createComponent, inject, signal, viewChild,
} from '@angular/core';
import { HostilePanel, PANEL_TOKEN } from './hostile-panel';
import { PanelDomCache } from './persistence';

type HostName = 'leafA' | 'leafB' | 'floating' | 'hidden';
type Strategy = 'host' | 'vcr' | 'inline';
const PANELS = ['p1', 'p2'] as const;

const params = new URLSearchParams(location.search);

/**
 * M0 spike. Two strategies for zero-unmount, chosen by `?strategy=`:
 *
 *  - `host` (primary): `createComponent(..., { hostElement: cacheEl })` + `appRef.attachView`.
 *    The panel's host element IS the cache element, which is moved imperatively.
 *  - `vcr` (fallback): the panel is created in a persistent hidden ViewContainerRef, and its
 *    host element is moved imperatively.
 *
 * Leaf B and the floating host only exist while a panel is placed there, so hosts are really
 * destroyed and re-created during the run — the case that would unmount a panel whose view
 * lived inside its host.
 */
@Component({
  selector: 'app-root',
  imports: [HostilePanel],
  template: `
    <div class="row" style="align-items:center">
      <b>ndd M0 spike</b> strategy: {{ strategy }} · zone: {{ zoneMode }} · active: {{ activeId() }}
    </div>
    <!-- Re-keyed by rebuild(): every host is destroyed and re-created with panels inside. -->
    @for (g of [generation()]; track g) {
      <div class="row">
        <div class="host" #leafA><h4>leaf A — {{ names('leafA') }}</h4>
          @if (strategy === 'inline') { @for (id of inHost('leafA'); track id) { <spike-hostile-panel [id]="id" /> } }
        </div>
        @if (used('leafB')) {
          <div class="host" #leafB><h4>leaf B — {{ names('leafB') }}</h4>
            @if (strategy === 'inline') { @for (id of inHost('leafB'); track id) { <spike-hostile-panel [id]="id" /> } }
          </div>
        }
      </div>
      @if (used('floating')) {
        <div class="floating" #floating><h4>floating</h4>
          @if (strategy === 'inline') { @for (id of inHost('floating'); track id) { <spike-hostile-panel [id]="id" /> } }
        </div>
      }
    }
    <div style="display:none"><ng-container #store /></div>
  `,
})
export class App {
  protected readonly strategy: Strategy = (['vcr', 'inline'] as const).find(s => s === params.get('strategy')) ?? 'host';
  /** Negative control for the gate's own selftest: restoration switched off. */
  private readonly preserve = !params.has('nopreserve');
  protected readonly zoneMode = typeof (window as any).Zone !== 'undefined' ? 'zone.js' : 'zoneless';

  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private readonly cache = new PanelDomCache();
  private readonly refs = new Map<string, ComponentRef<HostilePanel>>();

  protected readonly placement = signal<Record<string, HostName>>({ p1: 'leafA', p2: 'leafB' });
  protected readonly activeId = signal('p1');
  protected readonly generation = signal(0);

  private readonly leafA = viewChild<ElementRef<HTMLElement>>('leafA');
  private readonly leafB = viewChild<ElementRef<HTMLElement>>('leafB');
  private readonly floating = viewChild<ElementRef<HTMLElement>>('floating');
  private readonly store = viewChild.required('store', { read: ViewContainerRef });

  /** The resolved host element per panel — the only thing the move effect depends on. */
  private readonly targets = computed(() => {
    const p = this.placement();
    const host = (h: HostName): HTMLElement | null => {
      switch (h) {
        case 'leafA': return this.leafA()?.nativeElement ?? null;
        case 'leafB': return this.leafB()?.nativeElement ?? null;
        case 'floating': return this.floating()?.nativeElement ?? null;
        case 'hidden': return null;
      }
    };
    return PANELS.map(id => ({ id, host: host(p[id]), wanted: p[id] }));
  });

  constructor() {
    afterRenderEffect(() => {
      if (this.strategy === 'inline') return;
      this.ensureCreated();
      for (const t of this.targets()) {
        // A wanted host that has not rendered yet resolves to null: park in the store; the
        // host arriving is itself a change and re-runs this effect.
        this.cache.moveTo(t.id, t.host, this.activeId() === t.id, this.preserve);
      }
    });

    (window as any).__spike = {
      move: (id: string, to: HostName) => this.placement.update(p => ({ ...p, [id]: to })),
      setActive: (id: string) => this.activeId.set(id),
      setLabel: (id: string, label: string) => this.refs.get(id)?.setInput('label', label),
      where: (id: string) => this.placement()[id],
      rebuild: () => this.generation.update(g => g + 1),
    };
  }

  protected used(h: HostName): boolean {
    return Object.values(this.placement()).includes(h);
  }

  protected inHost(h: HostName): string[] {
    return PANELS.filter(id => this.placement()[id] === h);
  }

  protected names(h: HostName): string {
    return PANELS.filter(id => this.placement()[id] === h).join(', ') || 'empty';
  }

  private ensureCreated(): void {
    for (const id of PANELS) {
      if (this.refs.has(id)) continue;
      const elementInjector = Injector.create({
        providers: [{ provide: PANEL_TOKEN, useValue: `token-${id}` }],
        parent: this.injector,
      });
      let ref: ComponentRef<HostilePanel>;
      if (this.strategy === 'host') {
        ref = createComponent(HostilePanel, {
          environmentInjector: this.envInjector,
          elementInjector,
          hostElement: this.cache.elementFor(id),
        });
        this.appRef.attachView(ref.hostView);
      } else {
        ref = this.store().createComponent(HostilePanel, { injector: elementInjector });
        this.cache.register(id, ref.location.nativeElement as HTMLElement);
      }
      ref.setInput('id', id);
      this.refs.set(id, ref);
    }
  }
}
