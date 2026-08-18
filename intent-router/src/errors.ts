export class RouterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus = 500,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
