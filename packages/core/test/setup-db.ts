import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { connectDB, disconnectDB, ensureSetup } from "../src";

let mongod: MongoMemoryServer;

export function useTestDB() {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri("finance-test"));
  });
  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
    await ensureSetup();
  });
  afterAll(async () => {
    await disconnectDB();
    await mongod?.stop();
  });
}
