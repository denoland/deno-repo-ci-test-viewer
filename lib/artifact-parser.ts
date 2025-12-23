import {
  BlobReader,
  BlobWriter,
  type FileEntry,
  ZipReader,
} from "@zip-js/zip-js";
import { ExtractInterface } from "./types.ts";
import type { RecordedTestResult } from "./test-results-downloader.ts";

export type ArtifactParser = ExtractInterface<ZipArtifactParser>;

export class ZipArtifactParser {
  async parse(artifactName: string, blob: Blob) {
    const zipReader = new ZipReader(new BlobReader(blob));
    const entries = await zipReader.getEntries();

    // GitHub artifacts should contain a single file with the same name as the artifact
    const jsonEntry = entries.find((entry) =>
      !entry.directory &&
      (entry.filename.endsWith(".json") || entry.filename === artifactName)
    ) as FileEntry | undefined;

    if (!jsonEntry) {
      throw new Error(
        `No JSON file found in artifact "${artifactName}"`,
      );
    }

    // extract the file data
    const blobWriter = new BlobWriter();
    const fileBlob = await jsonEntry.getData(blobWriter);
    const fileData = new Uint8Array(await fileBlob.arrayBuffer());

    await zipReader.close();

    const text = new TextDecoder().decode(fileData);
    const data = JSON.parse(text);
    return {
      name: artifactName.replace(/^test-results-/, "")
        .replace(/.json$/, ""),
      tests: data.tests as RecordedTestResult[],
    };
  }
}
