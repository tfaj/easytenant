import { MongoMemoryReplSet } from "mongodb-memory-server-core";

// A real single-node replica set (transactions need one). Set
// MONGOMS_SYSTEM_BINARY to use a local mongod instead of downloading.
let rs: MongoMemoryReplSet | undefined;

export async function setup() {
  if (process.env.TEST_MONGO_URI) return;
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.TEST_MONGO_URI = rs.getUri();
}

export async function teardown() {
  await rs?.stop();
}
