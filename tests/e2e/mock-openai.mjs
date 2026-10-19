// Minimal stand-in for the OpenAI Responses API, used ONLY by end-to-end tests.
// Records every request so tests can verify what context the server sent to the model.
import http from 'node:http'

const requests = []
const replies = {
  assistant_reply: () => ({
    reply: 'הנה שתי הצעות (תשובת בדיקה מדומה).',
    suggestions: [
      { kind: 'rewrite', target: 'body', text: 'גוף משופר מהעוזר', reason: 'מחדד את הבעיה.' },
      { kind: 'new_hook', target: 'none', text: 'הוק חדש מהעוזר', reason: 'פותח לופ.' },
    ],
  }),
  research_reply: () => ({
    reply: 'הבנתי. מה הם כבר ניסו? (תשובת בדיקה מדומה)',
    updates: [
      { section: 'pains', text: 'עייפות בבוקר', provenance: 'user', source: '' },
      { section: 'language', text: 'אין לי כוח לבקרים האלה', provenance: 'ai_example', source: '' },
    ],
    suggested_angle: 'בוקר רגוע בלי מאמץ',
  }),
  script_review: () => ({ findings: [{ kind: 'note', target: 'none', text: 'יש חזרה בין הליד לגוף (בדיקה)', reason: 'חוסך זמן.', issue: 'repetition' }] }),
  connection_check: () => ({ text: 'החיבור עובד (בדיקה מדומה).' }),
  short_version: () => ({ hooks: ['הוק מקוצר'], lead: 'ליד מקוצר', body: 'גוף מקוצר', cta: 'קנו עכשיו', shooting: '', notes: 'קיצרנו חזרות (בדיקה).' }),
}

http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/__requests') {
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify(requests))
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) {
        const id = decodeURIComponent(req.url.slice('/v1/models/'.length))
        res.setHeader('Content-Type', 'application/json')
        if (id !== 'gpt-test') {
          res.statusCode = 404
          return res.end(JSON.stringify({ error: { message: 'model not found', type: 'invalid_request_error', code: 'model_not_found' } }))
        }
        return res.end(JSON.stringify({ id, object: 'model', created: 0, owned_by: 'test' }))
      }
      if (req.method === 'POST' && req.url === '/v1/responses') {
        const json = JSON.parse(body)
        requests.push({ auth: req.headers.authorization, body: json })
        const name = json.text?.format?.name
        const out = replies[name]?.() ?? {}
        res.setHeader('Content-Type', 'application/json')
        return res.end(
          JSON.stringify({
            id: `resp_${requests.length}`,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'completed',
            model: json.model,
            output: [{ type: 'message', id: `msg_${requests.length}`, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(out), annotations: [] }] }],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }),
        )
      }
      res.statusCode = 404
      res.end('{}')
    })
  })
  .listen(3199, () => console.log('mock openai on 3199'))
