import { assertEquals, assertRejects } from "@std/assert";
import { ZipArtifactParser } from "./artifact-parser.ts";
import { BlobWriter, ZipWriter, TextReader, configure } from "@zip-js/zip-js";
import type { RecordedTestResult } from "./test-results-downloader.ts";

// disable web workers to avoid resource leaks in tests
configure({ useWebWorkers: false });

async function createZipBlob(files: { filename: string; content: string }[]): Promise<Blob> {
  const blobWriter = new BlobWriter();
  const zipWriter = new ZipWriter(blobWriter);

  for (const file of files) {
    await zipWriter.add(file.filename, new TextReader(file.content));
  }

  await zipWriter.close();
  return await blobWriter.getData();
}

Deno.test("parse artifact with JSON file", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    {
      name: "test1",
      path: "test/test1.ts",
      duration: 100,
    },
    {
      name: "test2",
      path: "test/test2.ts",
      duration: 200,
      failed: true,
    },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const zipBlob = await createZipBlob([
    { filename: "results.json", content: jsonContent },
  ]);

  const result = await parser.parse("test-results-linux", zipBlob);

  assertEquals(result.name, "linux");
  assertEquals(result.tests.length, 2);
  assertEquals(result.tests[0].name, "test1");
  assertEquals(result.tests[0].duration, 100);
  assertEquals(result.tests[1].name, "test2");
  assertEquals(result.tests[1].failed, true);
});

Deno.test("parse artifact with matching filename", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    {
      name: "passing test",
      path: "test/pass.ts",
      duration: 50,
    },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const artifactName = "test-results-macos.json";
  const zipBlob = await createZipBlob([
    { filename: artifactName, content: jsonContent },
  ]);

  const result = await parser.parse(artifactName, zipBlob);

  assertEquals(result.name, "macos");
  assertEquals(result.tests.length, 1);
  assertEquals(result.tests[0].name, "passing test");
});

Deno.test("parse artifact with nested tests", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    {
      name: "parent test",
      path: "test/parent.ts",
      duration: 500,
      subTests: [
        {
          name: "child test 1",
          path: "test/parent.ts",
          duration: 200,
        },
        {
          name: "child test 2",
          path: "test/parent.ts",
          duration: 300,
          failed: true,
        },
      ],
    },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const zipBlob = await createZipBlob([
    { filename: "data.json", content: jsonContent },
  ]);

  const result = await parser.parse("test-results-windows", zipBlob);

  assertEquals(result.name, "windows");
  assertEquals(result.tests.length, 1);
  assertEquals(result.tests[0].subTests?.length, 2);
  assertEquals(result.tests[0].subTests?.[0].name, "child test 1");
  assertEquals(result.tests[0].subTests?.[1].failed, true);
});

Deno.test("parse artifact with flaky tests", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    {
      name: "flaky test",
      path: "test/flaky.ts",
      duration: 150,
      flakyCount: 3,
    },
    {
      name: "ignored test",
      path: "test/ignored.ts",
      ignored: true,
    },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const zipBlob = await createZipBlob([
    { filename: "results.json", content: jsonContent },
  ]);

  const result = await parser.parse("test-results-ubuntu.json", zipBlob);

  assertEquals(result.name, "ubuntu");
  assertEquals(result.tests.length, 2);
  assertEquals(result.tests[0].flakyCount, 3);
  assertEquals(result.tests[1].ignored, true);
});

Deno.test("parse artifact with multiple files (prefers JSON)", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    { name: "correct test", path: "test/test.ts", duration: 100 },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const zipBlob = await createZipBlob([
    { filename: "readme.txt", content: "This is not the file you're looking for" },
    { filename: "results.json", content: jsonContent },
    { filename: "other.txt", content: "Also not the right file" },
  ]);

  const result = await parser.parse("test-results-ci", zipBlob);

  assertEquals(result.name, "ci");
  assertEquals(result.tests.length, 1);
  assertEquals(result.tests[0].name, "correct test");
});

Deno.test("throw error when no JSON file found", async () => {
  const parser = new ZipArtifactParser();

  const zipBlob = await createZipBlob([
    { filename: "readme.txt", content: "Not a JSON file" },
    { filename: "data.xml", content: "<xml></xml>" },
  ]);

  await assertRejects(
    () => parser.parse("test-results-empty", zipBlob),
    Error,
    'No JSON file found in artifact "test-results-empty"',
  );
});

Deno.test("throw error when zip only contains directories", async () => {
  const parser = new ZipArtifactParser();

  const blobWriter = new BlobWriter();
  const zipWriter = new ZipWriter(blobWriter);

  // Add a directory entry (no content)
  await zipWriter.add("folder/", new TextReader(""));

  await zipWriter.close();
  const zipBlob = await blobWriter.getData();

  await assertRejects(
    () => parser.parse("test-results-dirs-only", zipBlob),
    Error,
    'No JSON file found in artifact "test-results-dirs-only"',
  );
});

Deno.test("parse empty test results array", async () => {
  const parser = new ZipArtifactParser();

  const jsonContent = JSON.stringify({ tests: [] });
  const zipBlob = await createZipBlob([
    { filename: "empty.json", content: jsonContent },
  ]);

  const result = await parser.parse("test-results-no-tests.json", zipBlob);

  assertEquals(result.name, "no-tests");
  assertEquals(result.tests.length, 0);
});

Deno.test("handle complex artifact name extraction", async () => {
  const parser = new ZipArtifactParser();

  const testResults: RecordedTestResult[] = [
    { name: "test", path: "test.ts", duration: 10 },
  ];

  const jsonContent = JSON.stringify({ tests: testResults });
  const zipBlob = await createZipBlob([
    { filename: "data.json", content: jsonContent },
  ]);

  const result = await parser.parse("test-results-complex-name-v2.json", zipBlob);

  // Should strip "test-results-" prefix and ".json" suffix
  assertEquals(result.name, "complex-name-v2");
});
