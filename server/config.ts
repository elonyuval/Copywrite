// Central server configuration, read from environment variables.
const env = process.env

function required(name: string): string {
  const v = env[name]
  if (!v) throw new Error(`Missing required environment variable ${name}. See .env.example`)
  return v
}

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  setupToken: env.SETUP_TOKEN ?? '',
  // Render sets RENDER_EXTERNAL_URL automatically.
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '',
  openaiApiKey: env.OPENAI_API_KEY ?? '',
  openaiModel: env.OPENAI_MODEL || 'gpt-5.5',
  /** Optional: OpenAI-compatible endpoint (proxy / gateway). Leave empty for api.openai.com. */
  openaiBaseUrl: env.OPENAI_BASE_URL || undefined,
  uploadDir: env.UPLOAD_DIR ?? './data/uploads',
  backupDir: env.BACKUP_DIR ?? './data/backups',
  backupEnabled: env.BACKUP_ENABLED !== 'false',
  backupKeep: Number(env.BACKUP_KEEP ?? 14),
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,
  sessionDays: 30,
  /** Minimum interval between automatic history snapshots of a creative. */
  autoVersionMinutes: 10,
}

export const aiConfigured = () => Boolean(config.openaiApiKey)
