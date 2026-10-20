import { copyFile, writeFile } from 'node:fs/promises'

const output = new URL('../../dist/vercel-demo/', import.meta.url)
await copyFile(new URL('../demo-vercel.json', import.meta.url), new URL('vercel.json', output))
await writeFile(new URL('.vercelignore', output), '.vercel\n*.log\n')
console.log('Vercel demo is ready in dist/vercel-demo; it contains only static demo assets.')
