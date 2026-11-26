/**
 * A failure that retrying cannot fix (invalid number, outside WhatsApp's 24-hour window without an
 * approved template, …). The outbox skips the remaining retries and moves straight to the fallback channel.
 */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentSendError';
  }
}
