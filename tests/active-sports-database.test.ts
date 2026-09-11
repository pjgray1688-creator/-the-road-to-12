import test from "node:test";
import { execFileSync } from "node:child_process";

const connection = process.env.R12_TEST_DATABASE_URL;
test("Active Sports database permissions, real reconciliation, price history, checkout and local POS", { skip: !connection && "Requires a disposable local PostgreSQL database with repository migrations applied" }, () => {
  const parsed = new URL(connection!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Database regression tests require a local disposable database");
  execFileSync("psql", [connection!, "-v", "ON_ERROR_STOP=1", "-f", "tests/sql/active-sports-launch.sql"], { stdio: "pipe" });
});
