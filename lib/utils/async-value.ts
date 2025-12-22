export class AsyncValue<TValue> {
  #value: Promise<TValue> | TValue;

  constructor(value: () => Promise<TValue>) {
    this.#value = value().then((value) => {
      this.#value = value;
      return value;
    });
  }

  async get(): Promise<TValue> {
    if (this.#value instanceof Promise) {
      return await this.#value;
    }
    return this.#value;
  }
}
