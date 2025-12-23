export class LoggerFactory {
  #requestId = 0;

  getRequestLogger() {
    this.#requestId += 1;
    if (this.#requestId === Number.MAX_SAFE_INTEGER) {
      this.#requestId = 0;
    }
    return new Logger(this.#requestId);
  }
}

export class Logger {
  #context: string | number | undefined;

  constructor(context: string | number | undefined) {
    this.#context = context;
  }

  log(...args: unknown[]) {
    if (this.#context == null) {
      console.log(...args);
    } else {
      console.log(`[${this.#context}]`, ...args);
    }
  }

  logError(...args: unknown[]) {
    if (this.#context == null) {
      console.error(...args);
    } else {
      console.error(`[${this.#context}]`, ...args);
    }
  }

  withContext(context: string) {
    if (this.#context) {
      return new Logger(this.#context + "::" + context);
    } else {
      return new Logger(context);
    }
  }
}
