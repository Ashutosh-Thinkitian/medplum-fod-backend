import esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/golden-record-mdm.ts'],
  bundle: true, platform: 'node', target: 'es2020', format: 'cjs',
  external: ['@medplum/*'],
  outfile: 'dist/golden-record-mdm.cjs',
  footer: { js: 'Object.assign(exports, module.exports);' },
});
console.log('Built dist/golden-record-mdm.cjs');
