export default class OpenScadError extends Error {
  code: string;
  stdErr: string[];

  constructor(message: string, code: string, stdErr: string[]) {
    super(message);
    this.name = 'OpenScadError';
    this.code = code;
    this.stdErr = stdErr;
  }
}
