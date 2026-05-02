import { createHash } from 'node:crypto';

export function hashProgram(code: string) {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}
