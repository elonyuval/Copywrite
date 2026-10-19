import { migrate, pool } from './db'
await migrate()
await pool.end()
