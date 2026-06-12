import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/patient-fuzzy-match.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2020',
  // CommonJS: Medplum's vmcontext runtime wraps the code with `const exports = {}; const module = {exports}`
  // and calls `exports.handler(...)`. ESM `export {}` is a syntax error in that context
  // ("Unexpected token 'export'"), so we emit CJS (esbuild produces `exports.handler = ...`).
  format: 'cjs',
  // @medplum/core is provided by the bot runtime; everything else (our local files) is inlined.
  external: ['@medplum/*'],
  outfile: 'dist/patient-fuzzy-match.cjs',
  // Required for VM Context Bots: esbuild's CJS output reassigns `module.exports` to a new object,
  // but the vmcontext wrapper reads `handler` off the original `exports` object. This footer copies
  // the exports back so `exports.handler(...)` resolves. (Matches Medplum's official demo-bots config.)
  footer: { js: 'Object.assign(exports, module.exports);' },
});
console.log('Built dist/patient-fuzzy-match.cjs');
