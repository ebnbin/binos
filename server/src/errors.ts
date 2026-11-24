import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiError, ErrorCode } from '@binos/protocol/core'

export type { ApiError, ErrorCode } from '@binos/protocol/core'

export class ApiException extends HTTPException {
  readonly code: ErrorCode
  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string) {
    super(status, { message })
    this.code = code
  }
}

export const badRequest = (message = '请求参数无效') => new ApiException(400, 'invalid-input', message)
export const notFound = (message = '要找的内容不存在') => new ApiException(404, 'not-found', message)
export const forbidden = (message = '没有权限这样做') => new ApiException(403, 'forbidden', message)
export const conflict = (message: string) => new ApiException(409, 'conflict', message)

const statusCodes: Partial<Record<number, [ErrorCode, string]>> = {
  400: ['invalid-input', '请求格式无效'],
  401: ['unauthorized', '需要重新登录'],
  403: ['forbidden', '没有权限这样做'],
  404: ['not-found', '要找的内容不存在'],
  409: ['conflict', '和现在的状态冲突'],
  413: ['too-large', '请求体太大'],
  415: ['unsupported-media-type', '请求体的格式不支持'],
}

export function toApiException(error: Error, fallback?: [ContentfulStatusCode, ErrorCode]): ApiException {
  if (error instanceof ApiException) return error
  if (error instanceof HTTPException) {
    const [code, message] = statusCodes[error.status] ?? ['internal', '服务器出错了']
    return new ApiException(error.status as ContentfulStatusCode, code, message)
  }
  return fallback ? new ApiException(fallback[0], fallback[1], error.message) : new ApiException(500, 'internal', '服务器出错了')
}

export const apiErrorBody = (error: ApiException): ApiError => ({ error: { code: error.code, message: error.message } })

// 挂在 api 上的统一错误处理。fallback：没归类的 Error（比如独立服务回复的错误）按这个状态码和 code 返回它的 message；
// 不给时是 500，message 不外露
export function errorHandler(fallback?: [ContentfulStatusCode, ErrorCode]): ErrorHandler {
  return (error, c) => {
    const exception = toApiException(error, fallback)
    if (exception.status >= 500 && !(error instanceof HTTPException)) console.error(error)
    return c.json(apiErrorBody(exception), exception.status as ContentfulStatusCode)
  }
}
