export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}
export const notFound = (what = 'הפריט') => new HttpError(404, `${what} לא נמצא`, 'not_found')
export const forbidden = () => new HttpError(403, 'אין הרשאה לפעולה זו', 'forbidden')
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request')
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict')
