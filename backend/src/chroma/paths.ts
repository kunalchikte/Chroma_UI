export type ApiMode = "v1" | "v2";

export type ResolvedChromaRoutes = {
  mode: ApiMode;
  heartbeatPath: () => string;
  versionPath: () => string;
  listCollectionsPath: () => string;
  getCollectionByIdPath: (collectionId: string) => string;
  countPath: (collectionId: string) => string;
  getDocsPath: (collectionId: string) => string;
  queryPath: (collectionId: string) => string;
};

const DEFAULT_TENANT = "default_tenant";
const DEFAULT_DATABASE = "default_database";

export function resolveRoutes(
  mode: ApiMode,
  tenant: string = DEFAULT_TENANT,
  database: string = DEFAULT_DATABASE,
): ResolvedChromaRoutes {
  if (mode === "v1") {
    const base = "/api/v1";
    return {
      mode,
      heartbeatPath: () => `${base}/heartbeat`,
      versionPath: () => `${base}/version`,
      listCollectionsPath: () => `${base}/collections`,
      getCollectionByIdPath: (collectionId) =>
        `${base}/collections/${encodeURIComponent(collectionId)}`,
      countPath: (collectionId) =>
        `${base}/collections/${encodeURIComponent(collectionId)}/count`,
      getDocsPath: (collectionId) =>
        `${base}/collections/${encodeURIComponent(collectionId)}/get`,
      queryPath: (collectionId) =>
        `${base}/collections/${encodeURIComponent(collectionId)}/query`,
    };
  }

  const root = `/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(
    database,
  )}`;
  return {
    mode,
    heartbeatPath: () => "/api/v2/heartbeat",
    versionPath: () => "/api/v2/version",
    listCollectionsPath: () => `${root}/collections`,
    getCollectionByIdPath: (collectionId) =>
      `${root}/collections/by-id/${encodeURIComponent(collectionId)}`,
    countPath: (collectionId) =>
      `${root}/collections/${encodeURIComponent(collectionId)}/count`,
    getDocsPath: (collectionId) =>
      `${root}/collections/${encodeURIComponent(collectionId)}/get`,
    queryPath: (collectionId) =>
      `${root}/collections/${encodeURIComponent(collectionId)}/query`,
  };
}
