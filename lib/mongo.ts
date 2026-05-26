import { MongoClient, type Db } from "mongodb";

declare global {
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (globalThis.__mongoClientPromise) {
    return globalThis.__mongoClientPromise;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI env var is required");
  }
  globalThis.__mongoClientPromise = new MongoClient(uri).connect();
  return globalThis.__mongoClientPromise;
}

export async function getMongo(): Promise<MongoClient> {
  return getClientPromise();
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db();
}
