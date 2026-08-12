import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGO_DB_URL;

if (!uri) {
  throw new Error("Missing MONGO_DB_URL in environment variables");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const client = new MongoClient(uri);
const clientPromise =
  global._mongoClientPromise ?? client.connect();

if (process.env.NODE_ENV !== "production") {
  global._mongoClientPromise = clientPromise;
}

export async function getDb(): Promise<Db> {
  const connected = await clientPromise;
  return connected.db("unified_portal");
}
