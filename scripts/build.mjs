/** Build the Host entry and the DSH browser module factory from this repository. */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await mkdir(resolve(root, 'lib'), { recursive: true })
await build({ entryPoints: [resolve(root, 'src/index.ts')], outfile: resolve(root, 'lib/index.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const result = await build({
  absWorkingDir: root, entryPoints: ['src/client/index.ts'], bundle: true, write: false,
  outfile: 'lib/client.js', platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zod', '@deepseek-ai/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
  plugins: [{
    name: 'dsh-annotation-css',
    setup(builder) {
      builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
        const compiled = transform({ filename: basename(path), code: await readFile(path),
          minify: true, cssModules: { pattern: 'dsh_ann_[local]_[hash]' } })
        const classes = Object.fromEntries(Object.entries(compiled.exports).map(([key, value]) => [key, value.name]))
        const tagId = `${manifest.name}/${basename(path)}`
        return { loader: 'js', watchFiles: [path], contents: `
          if (!document.querySelector('style[data-plugin-css='+JSON.stringify(${JSON.stringify(tagId)})+']')) {
            const tag=document.createElement('style');
            tag.dataset.plugin=${JSON.stringify(manifest.name)};
            tag.dataset.pluginCss=${JSON.stringify(tagId)};
            tag.textContent=${JSON.stringify(compiled.code.toString())};
            document.head.append(tag);
          }
          export default ${JSON.stringify(classes)};
        ` }
      })
    },
  }],
})
await writeFile(resolve(root, 'lib/client.js'), result.outputFiles[0].contents)
console.log(`Built ${manifest.name}@${manifest.version}`)
