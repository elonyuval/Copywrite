import { createApp } from './app'
import { createServer } from './collab'
import { config } from './config'
import { migrate } from './db'
import { ensureStorage } from './storage'

await migrate()
await ensureStorage()
const app = createApp()
const server = createServer(app)
await server.listen(config.port)
console.log(`[copywrite] listening on http://localhost:${config.port}  (AI: ${config.openaiApiKey ? config.openaiModel : 'not configured'})`)
