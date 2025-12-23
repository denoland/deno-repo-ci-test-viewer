import { assertEquals, assertRejects } from "@std/assert";
import { AsyncValue } from "./async-value.ts";

Deno.test("should resolve value from async function", async () => {
  const asyncValue = new AsyncValue(() => Promise.resolve("test value"));

  const result = await asyncValue.get();
  assertEquals(result, "test value");
});

Deno.test("should cache resolved value", async () => {
  let callCount = 0;
  const asyncValue = new AsyncValue(async () => {
    callCount++;
    await Promise.resolve();
    return "cached value";
  });

  const result1 = await asyncValue.get();
  const result2 = await asyncValue.get();
  const result3 = await asyncValue.get();

  assertEquals(result1, "cached value");
  assertEquals(result2, "cached value");
  assertEquals(result3, "cached value");
  assertEquals(callCount, 1, "Value function should only be called once");
});

Deno.test("should handle concurrent get calls", async () => {
  let callCount = 0;
  const asyncValue = new AsyncValue(async () => {
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return "concurrent value";
  });

  const [result1, result2, result3] = await Promise.all([
    asyncValue.get(),
    asyncValue.get(),
    asyncValue.get(),
  ]);

  assertEquals(result1, "concurrent value");
  assertEquals(result2, "concurrent value");
  assertEquals(result3, "concurrent value");
  assertEquals(
    callCount,
    1,
    "Value function should only be called once even with concurrent access",
  );
});

Deno.test("should work with different value types", async () => {
  const numberValue = new AsyncValue(async () => await Promise.resolve(42));
  const objectValue = new AsyncValue(async () =>
    await Promise.resolve({ key: "value" })
  );
  const arrayValue = new AsyncValue(async () =>
    await Promise.resolve([1, 2, 3])
  );

  assertEquals(await numberValue.get(), 42);
  assertEquals(await objectValue.get(), { key: "value" });
  assertEquals(await arrayValue.get(), [1, 2, 3]);
});

Deno.test("should propagate errors from async function", async () => {
  const asyncValue = new AsyncValue(async () => {
    await Promise.resolve();
    throw new Error("Test error");
  });

  await assertRejects(
    async () => await asyncValue.get(),
    Error,
    "Test error",
  );
});

Deno.test("should handle delayed resolution", async () => {
  const asyncValue = new AsyncValue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return "delayed value";
  });

  const result = await asyncValue.get();
  assertEquals(result, "delayed value");
});

Deno.test("should return same value after error", async () => {
  let shouldError = true;
  const asyncValue = new AsyncValue(async () => {
    await Promise.resolve();
    if (shouldError) {
      throw new Error("Initial error");
    }
    return "success value";
  });

  await assertRejects(
    async () => await asyncValue.get(),
    Error,
    "Initial error",
  );

  shouldError = false;

  await assertRejects(
    async () => await asyncValue.get(),
    Error,
    "Initial error",
  );
});

Deno.test("should work with null and undefined values", async () => {
  const nullValue = new AsyncValue(async () => await Promise.resolve(null));
  const undefinedValue = new AsyncValue(async () =>
    await Promise.resolve(undefined)
  );

  assertEquals(await nullValue.get(), null);
  assertEquals(await undefinedValue.get(), undefined);
});

Deno.test("should handle complex async operations", async () => {
  const asyncValue = new AsyncValue(async () => {
    const step1 = await Promise.resolve(10);
    const step2 = await Promise.resolve(step1 * 2);
    const step3 = await Promise.resolve(step2 + 5);
    return step3;
  });

  const result = await asyncValue.get();
  assertEquals(result, 25);
});
