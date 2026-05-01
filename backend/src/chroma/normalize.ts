export type NormalizedCollection = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
  /** Best-effort doc count; omit when unknown */
  count?: number;
};

export type NormalizedCollectionDetail = NormalizedCollection;

export type NormalizedHit = {
  id?: string;
  document?: string | null;
  metadata?: Record<string, unknown> | null;
  distance?: number | null;
};

export type NormalizedSamples = {
  ids: string[];
  documents: (string | null | undefined)[];
  metadatas: (Record<string, unknown> | null | undefined)[];
};

export function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

export function normalizeCollectionModel(raw: unknown): NormalizedCollection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = pickString(r.id) ?? pickString(r.collection_id);
  const name = pickString(r.name);
  if (!id || !name) return null;

  const md = r.metadata;
  const metadata =
    md && typeof md === "object" && !Array.isArray(md)
      ? (md as Record<string, unknown>)
      : null;

  return { id, name, metadata };
}

export function normalizeCollectionsListPayload(body: unknown): NormalizedCollection[] {
  const list: unknown[] =
    Array.isArray(body) ? body : Array.isArray((body as { collections?: unknown }).collections)
      ? ((body as { collections: unknown[] }).collections)
      : [];

  return list.map(normalizeCollectionModel).filter((x): x is NormalizedCollection => x !== null);
}

export function embeddingHintFromMetadata(md: Record<string, unknown> | null): string | undefined {
  if (!md) return undefined;
  for (const key of [
    "embedding_model",
    "embedding_function",
    "embeddings",
    "hnsw:space",
  ]) {
    const v = md[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function normalizeQueryResult(body: unknown): NormalizedHit[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  const idsNested = b.ids;
  const distNested = b.distances;
  const docsNested = b.documents;
  const metaNested = b.metadatas;

  const ids = Array.isArray(idsNested) ? (idsNested[0] as unknown) : undefined;
  const distances = Array.isArray(distNested) ? (distNested[0] as unknown) : undefined;
  const documents = Array.isArray(docsNested) ? (docsNested[0] as unknown) : undefined;
  const metadatas = Array.isArray(metaNested) ? (metaNested[0] as unknown) : undefined;

  if (!Array.isArray(ids)) return [];

  const out: NormalizedHit[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = typeof ids[i] === "string" ? ids[i] : undefined;
    const distance = Array.isArray(distances) ? (distances[i] as unknown) : undefined;
    const document = Array.isArray(documents)
      ? (documents[i] as string | null | undefined)
      : undefined;
    const metadata = Array.isArray(metadatas)
      ? (metadatas[i] as Record<string, unknown> | null | undefined)
      : undefined;

    out.push({
      id,
      document: typeof document === "string" ? document : document ?? undefined,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata
        : undefined,
      distance: typeof distance === "number"
        ? distance
        : distance === null
        ? null
        : typeof distance === "string"
        ? Number(distance)
        : undefined,
    });
  }
  return out;
}

export function normalizeGetResult(body: unknown): NormalizedSamples {
  const empty = { ids: [], documents: [], metadatas: [] };
  if (!body || typeof body !== "object") return empty;
  const b = body as Record<string, unknown>;

  const ids = Array.isArray(b.ids) ? (b.ids as string[]) : [];
  const documents = Array.isArray(b.documents) ? (b.documents as (string | null | undefined)[]) : [];
  const metadatas = Array.isArray(b.metadatas)
    ? (b.metadatas as (Record<string, unknown> | null | undefined)[])
    : [];

  return {
    ids: ids.filter((id) => typeof id === "string"),
    documents,
    metadatas,
  };
}
