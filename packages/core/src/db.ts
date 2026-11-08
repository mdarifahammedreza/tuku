import mongoose from "mongoose";

const g = globalThis as unknown as { __mongoose?: Promise<typeof mongoose> };

/** Single cached connection (safe across Next.js hot reloads). */
export function connectDB(uri = process.env.MONGODB_URI): Promise<typeof mongoose> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  g.__mongoose ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 }).catch((err) => {
    g.__mongoose = undefined;
    throw err;
  });
  return g.__mongoose;
}

export async function disconnectDB() {
  g.__mongoose = undefined;
  await mongoose.disconnect();
}
