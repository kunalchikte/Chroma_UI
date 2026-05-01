import { describe, expect, it } from "vitest";
import {
  normalizeCollectionsListPayload,
  normalizeGetResult,
  normalizeQueryResult,
} from "./normalize.js";

describe("normalizeCollectionsListPayload", () => {
  it("handles v1-ish array payloads", () => {
    const list = normalizeCollectionsListPayload([
      { id: "c1", name: "posts", metadata: { a: 1 } },
      { bad: true },
    ]);
    expect(list).toEqual([
      {
        id: "c1",
        name: "posts",
        metadata: { a: 1 },
      },
    ]);
  });

  it("handles wrapped collections key", () => {
    expect(
      normalizeCollectionsListPayload({
        collections: [{ id: "x", name: "y", metadata: null }],
      }),
    ).toEqual([{ id: "x", name: "y", metadata: null }]);
  });
});

describe("normalizeQueryResult", () => {
  it("flattens first query group", () => {
    expect(
      normalizeQueryResult({
        ids: [["a", "b"]],
        distances: [[0.1, 0.2]],
        documents: [["hello", "world"]],
        metadatas: [[{ foo: "bar" }, null]],
      }),
    ).toEqual([
      { id: "a", distance: 0.1, document: "hello", metadata: { foo: "bar" } },
      { id: "b", distance: 0.2, document: "world", metadata: undefined },
    ]);
  });
});

describe("normalizeGetResult", () => {
  it("parses arrays", () => {
    expect(
      normalizeGetResult({
        ids: ["1"],
        documents: ["d"],
        metadatas: [{ k: true }],
      }),
    ).toEqual({
      ids: ["1"],
      documents: ["d"],
      metadatas: [{ k: true }],
    });
  });
});
