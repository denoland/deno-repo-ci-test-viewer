export class LoggerFactory {
  #requestId = 0;
  getLogger() {
    this.#requestId += 1;
    if (this.#requestId === Number.MAX_SAFE_INTEGER) {
      this.#requestId = 0;
    }
    return new Logger(this.#requestId);
  }
}

export class Logger {
  #requestId: number;

  constructor(requestId: number) {
    this.#requestId = requestId;
  }

  log(...args: unknown[]) {
    console.log(`[${this.#requestId}]`, ...args);
  }
}
