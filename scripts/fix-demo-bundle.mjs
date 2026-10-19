// The artifact publisher rejects raw U+FFFD characters; some libraries embed one inside string
// literals. Replace each with its � escape, which is identical at runtime.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
const dir = 'dist-demo/assets'
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(`${dir}/${f}`, 'utf8')
  if (src.includes('�')) writeFileSync(`${dir}/${f}`, src.replaceAll('�', '\\uFFFD'))
}
