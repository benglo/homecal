import { v7 as uuidv7 } from 'uuid';

/** Server-generated, time-ordered IDs. Never trust a client-supplied id. */
export function newId(): string {
  return uuidv7();
}
