import { VERSION } from '../src/public-api';
import pkg from '../package.json';

describe('smoke', () => {
  it('exports a VERSION matching package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
