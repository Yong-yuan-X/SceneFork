export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly code = 'INTERNAL_ERROR',
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code)
  }
}

export class ProviderError extends AppError {
  constructor(
    message: string,
    readonly outcomeUnknown = false,
    readonly requestId: string | null = null,
  ) {
    super(message, 502, outcomeUnknown ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_ERROR')
  }
}
