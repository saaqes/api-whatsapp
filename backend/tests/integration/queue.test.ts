import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/database/prisma.js";
import { JobQueue, NonRetryableError } from "../../src/queue/job-queue.js";
import { resetDb } from "../helpers.js";
import { sleep } from "../../src/utils/time.js";

beforeEach(async () => {
  await resetDb();
});

describe("cola de trabajos en PostgreSQL", () => {
  it("nunca ejecuta en paralelo dos trabajos del mismo grupo y conserva el orden", async () => {
    const q = new JobQueue(4);
    const log: string[] = [];
    let concurrentSameGroup = 0;
    let maxConcurrent = 0;
    q.register("t", async (p: { g: string; n: number }) => {
      if (p.g === "A") {
        concurrentSameGroup++;
        maxConcurrent = Math.max(maxConcurrent, concurrentSameGroup);
      }
      await sleep(30);
      log.push(`${p.g}${p.n}`);
      if (p.g === "A") concurrentSameGroup--;
    });
    for (let n = 1; n <= 3; n++) await q.enqueue("t", { g: "A", n }, { groupKey: "A" });
    await q.enqueue("t", { g: "B", n: 1 }, { groupKey: "B" });
    await q.drain();
    expect(maxConcurrent).toBe(1);
    expect(log.filter((x) => x.startsWith("A"))).toEqual(["A1", "A2", "A3"]);
    expect(log).toContain("B1");
  });

  it("deduplica y pospone trabajos pendientes (debounce)", async () => {
    const q = new JobQueue();
    const id1 = await q.enqueue("t", { v: 1 }, { dedupeKey: "k", debounce: true, delayMs: 1000 });
    const id2 = await q.enqueue("t", { v: 2 }, { dedupeKey: "k", debounce: true, delayMs: 5000 });
    expect(id2).toBe(id1);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: id1 } });
    expect(job.payload).toEqual({ v: 2 });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 4000);
    expect(await prisma.job.count()).toBe(1);
  });

  it("reintenta con espera exponencial y falla tras el máximo de intentos", async () => {
    const q = new JobQueue();
    let calls = 0;
    q.register("t", async () => {
      calls++;
      throw new Error("temporal");
    });
    const id = await q.enqueue("t", {}, { maxAttempts: 2 });
    await q.drain();
    let job = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({ status: "PENDING", attempts: 1, lastError: "temporal" });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 3000);
    await prisma.job.update({ where: { id }, data: { runAt: new Date() } });
    await q.drain();
    job = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("FAILED");
    expect(calls).toBe(2);
    expect(await prisma.errorLog.count({ where: { source: "QUEUE" } })).toBe(1);
  });

  it("no reintenta errores marcados como definitivos", async () => {
    const q = new JobQueue();
    q.register("t", async () => {
      throw new NonRetryableError("definitivo");
    });
    const id = await q.enqueue("t", {}, { maxAttempts: 5 });
    await q.drain();
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("recupera trabajos interrumpidos por un reinicio y los ejecuta con el temporizador", async () => {
    await prisma.job.create({ data: { type: "t", payload: {}, status: "RUNNING", lockedAt: new Date() } });
    const q = new JobQueue();
    let ran = 0;
    q.register("t", async () => {
      ran++;
    });
    await q.start();
    for (let i = 0; i < 50 && ran === 0; i++) await sleep(20);
    await q.stop();
    expect(ran).toBe(1);
  });

  it("ejecuta trabajos programados en el futuro sin consultar la base de datos en bucle", async () => {
    const q = new JobQueue();
    let ranAt = 0;
    q.register("t", async () => {
      ranAt = Date.now();
    });
    await q.start();
    const start = Date.now();
    await q.enqueue("t", {}, { delayMs: 300 });
    for (let i = 0; i < 100 && ranAt === 0; i++) await sleep(20);
    await q.stop();
    expect(ranAt - start).toBeGreaterThanOrEqual(280);
  });
});
