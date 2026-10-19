import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import { originAllowed, requireAuth } from './auth'
import { HttpError } from './errors'
import { aiRouter } from './routes/ai'
import { authRouter } from './routes/auth'
import { catalogRouter } from './routes/catalog'
import { externalRouter, tokensRouter } from './routes/external'
import { preferencesRouter } from './routes/preferences'
import { productionRouter } from './routes/production'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    next()
  })

  app.get('/api/health', (_req, res) => void res.json({ ok: true }))

  // External read-only API (bearer tokens; no cookies involved).
  app.use('/api/ext/v1', externalRouter)

  app.use('/api', express.json({ limit: '2mb' }), cookieParser())
  // Reject cross-site state-changing requests.
  app.use('/api', (req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req.headers.origin, req.headers.host)) {
      return next(new HttpError(403, 'בקשה ממקור לא מורשה', 'bad_origin'))
    }
    next()
  })
  app.use('/api', authRouter)
  app.use('/api', requireAuth, catalogRouter, productionRouter, aiRouter, preferencesRouter, tokensRouter)
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'נתיב לא קיים', 'not_found')))

  // Built frontend (production). In development Vite serves it and proxies /api and /collab.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const webDir = [path.join(here, 'web'), path.join(here, '..', 'dist', 'web')].find((p) => existsSync(path.join(p, 'index.html')))
  if (webDir) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')))
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: err.issues[0]?.message ?? 'נתונים לא תקינים', code: 'validation', issues: err.issues })
    }
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, code: err.code })
    if (err?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: 'הקובץ גדול מדי', code: 'too_large' })
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'בקשה לא תקינה', code: 'bad_json' })
    console.error('[api] error', err)
    res.status(500).json({ error: 'שגיאת שרת. הפעולה לא נשמרה.', code: 'server_error' })
  })
  return app
}
