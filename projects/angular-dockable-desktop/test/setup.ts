/**
 * Runs before every spec (angular.json → test → setupFiles).
 *
 * jsdom never loads the library stylesheet, so without this every `<ndd-desktop>` in a test
 * would (correctly) report "the stylesheet is not loaded". A real application has it; so does
 * the test environment, via the same sentinel the stylesheet declares. The diagnostics spec
 * removes it to prove the warning fires.
 */
document.documentElement.style.setProperty('--ndd-styles-loaded', '1');
