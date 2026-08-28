// lib/prisma.ts — the one PrismaClient for Travola Home.
//
// SHARED-DB build: DATABASE_URL points at the SAME Neon database as
// Travola-OS and the POS. The client generates into lib/generated/prisma
// and mirrors only the tables Travola Home reads (see prisma/schema.prisma
// — this repo never migrates).
//
// The client is built LAZILY, on first query rather than at import. Two
// reasons, both learned the hard way:
//
//   1. Importing a module for a pure function should not require a
//      database. Eager construction meant a unit test for date
//      arithmetic failed because a connection string was absent.
//   2. On a deployment with no DATABASE_URL, eager construction throws
//      while the module graph is loading, which crashes the request
//      before any handler can catch it and explain what is wrong. Built
//      lazily, the error surfaces inside the handler, where it is turned
//      into a sentence naming the missing variable.
import { PrismaClient } from "./generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prismaHome?: PrismaClient };

function makeClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  // Without this guard the pg driver silently defaults to
  // 127.0.0.1:5432 and every query fails with "can't reach database
  // server" — a message that points at the database rather than at the
  // env var that was never set.
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Travola Home needs the same Neon connection string as Travola-OS and the POS.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  if (!globalForPrisma.prismaHome) {
    const created = makeClient();
    // Cached in every environment: on serverless this keeps one pool per
    // warm instance, and in development it survives hot reloads instead
    // of leaking a connection per edit.
    globalForPrisma.prismaHome = created;
  }
  return globalForPrisma.prismaHome;
}

/**
 * A stand-in that behaves exactly like a PrismaClient but does not build
 * one until a property is actually read. `prisma.restaurant.findUnique`
 * constructs on the `.restaurant` access; merely importing this module
 * does not.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(client() as object, property, receiver);
    return typeof value === "function" ? value.bind(client()) : value;
  },
  has(_target, property) {
    return Reflect.has(client() as object, property);
  },
});

// NOTE: there is no RESTAURANT_ID constant. The tenant comes from the
// signed restaurant session on every request — see lib/tenant.ts
// (`requireRestaurant`). HOME_RESTAURANT_ID remains only as a
// non-production convenience for local sandboxes.
