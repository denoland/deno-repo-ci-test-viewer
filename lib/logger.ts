import type { ExtractInterface } from "./types.ts";

export class LoggerFactory {
  #requestId = 0;

  getRequestLogger(): Logger {
    this.#requestId += 1;
    if (this.#requestId === Number.MAX_SAFE_INTEGER) {
      this.#requestId = 0;
    }
    return new ConsoleLogger(this.#requestId);
  }
}

export type Logger = ExtractInterface<ConsoleLogger>;

export class ConsoleLogger {
  #context: string | number | undefined;

  constructor(context: string | number | undefined) {
    this.#context = context;
  }

  log(...args: unknown[]) {
    // deno-lint-ignore no-console
    this.#innerLog(console.log, args);
  }

  logError(...args: unknown[]) {
    // deno-lint-ignore no-console
    this.#innerLog(console.error, args);
  }

  logWarn(...args: unknown[]) {
    // deno-lint-ignore no-console
    this.#innerLog(console.warn, args);
  }

  #innerLog(func: (...args: unknown[]) => void, args: unknown[]) {
    if (this.#context == null) {
      func(...args);
    } else {
      func(`[${this.#context}]`, ...args);
    }
  }

  withContext(context: string): Logger {
    if (this.#context) {
      return new ConsoleLogger(this.#context + "::" + context);
    } else {
      return new ConsoleLogger(context);
    }
  }
}

export class NullLogger implements Logger {
  log(..._: unknown[]): void {
  }

  logError(..._: unknown[]): void {
  }

  logWarn(..._: unknown[]): void {
  }

  withContext(_context: string): Logger {
    return this;
  }
}
