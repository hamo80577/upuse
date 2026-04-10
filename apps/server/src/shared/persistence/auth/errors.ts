export class AuthStoreError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "AuthStoreError";
    this.status = status;
    this.code = code;
  }
}
