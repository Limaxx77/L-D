export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') =>
  new AppError(403, 'FORBIDDEN', message);
export const unauthorized = (message = 'Faça login para continuar.') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
