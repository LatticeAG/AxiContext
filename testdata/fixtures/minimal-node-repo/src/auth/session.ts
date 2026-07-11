export function createSession(userId: string): string {
  return `session:${userId}`;
}
