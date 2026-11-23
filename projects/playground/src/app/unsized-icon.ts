import { Component } from '@angular/core';

/**
 * `?poico=1` (rdd 7.12.2): an icon that takes its size from its box: an inline-block span with
 * width/height auto around an <svg> with only a viewBox, as a mat-icon set to width/height: auto.
 */
@Component({
  selector: 'pg-unsized-icon',
  template: `<span data-po-icon style="display: inline-block; width: auto; height: auto"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor" /></svg></span>`,
})
export class UnsizedIcon {}
