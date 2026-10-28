import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGO_DB_URL;

if (!uri) {
  throw new Error("Missing MONGO_DB_URL in environment variables");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

function createClient() {
  // Longer selection timeout helps during Atlas tier changes (e.g. → M10)
  // when the replica set is electing a new primary.
  return new MongoClient(uri!, {
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 20_000,
  });
}

function connectClient() {
  const client = createClient();
  global._mongoClient = client;
  const promise = client.connect();
  global._mongoClientPromise = promise;
  return promise;
}

let clientPromise = global._mongoClientPromise ?? connectClient();

if (process.env.NODE_ENV !== "production") {
  global._mongoClientPromise = clientPromise;
}

async function resetClient() {
  try {
    await global._mongoClient?.close();
  } catch {
    /* ignore */
  }
  global._mongoClient = undefined;
  global._mongoClientPromise = undefined;
  clientPromise = connectClient();
  if (process.env.NODE_ENV !== "production") {
    global._mongoClientPromise = clientPromise;
  }
  return clientPromise;
}

function isStaleTopologyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const name = error instanceof Error ? error.name : "";
  const cause =
    error && typeof error === "object" && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const causeMessage =
    cause instanceof Error ? cause.message : cause ? String(cause) : "";
  const causeName = cause instanceof Error ? cause.name : "";
  return (
    name.includes("ServerSelection") ||
    name.includes("MongoStalePrimary") ||
    name.includes("MongoNetwork") ||
    name.includes("PoolCleared") ||
    causeName.includes("MongoNetwork") ||
    causeName.includes("PoolCleared") ||
    message.includes("stale") ||
    message.includes("ReplicaSetNoPrimary") ||
    message.includes("ServerSelection") ||
    message.includes("electionId") ||
    message.includes("setVersion") ||
    message.includes("PoolClearedOnNetworkError") ||
    message.includes("interrupted due to server monitor timeout") ||
    message.includes("connection <monitor>") ||
    message.includes("timed out") ||
    causeMessage.includes("timed out") ||
    causeMessage.includes("PoolCleared")
  );
}

export async function getDb(): Promise<Db> {
  try {
    const connected = await clientPromise;
    // Ping forces SDAM to notice a dead/stale primary (common right after
    // an Atlas scale-up to M10) instead of failing on the next user query.
    await connected.db("admin").command({ ping: 1 });
    return connected.db("unified_portal");
  } catch (error) {
    if (!isStaleTopologyError(error)) {
      throw error;
    }
    const reconnected = await resetClient();
    await reconnected.db("admin").command({ ping: 1 });
    return reconnected.db("unified_portal");
  }
}

/** Reset the shared Mongo client after a mid-query pool/network failure. */
export async function resetMongoClient() {
  return resetClient();
}
