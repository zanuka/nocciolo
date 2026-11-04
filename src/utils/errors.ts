export class OrtoError extends Error {
  readonly hint?: string;
  readonly statusCode?: number;

  constructor(message: string, hint?: string, statusCode?: number) {
    super(message);
    this.name = "OrtoError";
    if (hint !== undefined) {
      this.hint = hint;
    }
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

export function formatError(error: unknown): string {
  if (error instanceof OrtoError) {
    const parts = [`Error: ${error.message}`];
    if (error.hint) {
      parts.push(`Hint: ${error.hint}`);
    }
    return parts.join("\n");
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}

export function isAuthError(error: unknown): boolean {
  if (error instanceof OrtoError) {
    return error.statusCode === 401 || error.statusCode === 403;
  }
  if (error instanceof Error) {
    return /\b401\b|\b403\b|Unauthorized|Forbidden/i.test(error.message);
  }
  return false;
}
