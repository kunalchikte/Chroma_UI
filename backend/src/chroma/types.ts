export type FailureCode = "UNREACHABLE" | "TIMEOUT" | "BAD_REQUEST" | "SERVER_ERROR" | "UNKNOWN";

export type ChromaCallLog = {
  template: string;
  method: string;
  elapsedMs: number;
  upstreamStatus?: number;
  upstreamPath: string;
  errorKind?: FailureCode;
};

export class ApiError extends Error {
  readonly code: FailureCode;
  readonly httpStatus?: number;

  constructor(message: string, code: FailureCode, httpStatus?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
