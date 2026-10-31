import { prisma, type Job } from "../database/prisma.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/errors.js";
import { logError } from "../services/errorlog.service.js";

export type JobHandler = (payload: any, job: Job) => Promise<void>;

/** Lanza este error desde un manejador para no reintentar (p. ej. error 400 de Meta). */
export class NonRetryableError extends Error {}

export interface EnqueueOptions {
  delayMs?: number;
  runAt?: Date;
  groupKey?: string;
  /** Si ya hay un trabajo PENDIENTE con esta clave, se reutiliza (y se pospone si `debounce`). */
  dedupeKey?: string;
  debounce?: boolean;
  maxAttempts?: number;
}

const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

/**
 * Cola de trabajos persistente sobre PostgreSQL (sin Redis).
 * - Los trabajos sobreviven reinicios.
 * - Trabajos con el mismo `groupKey` nunca corren en paralelo (orden por contacto).
 * - No consulta la base de datos en bucle: se despierta al encolar y con un temporizador
 *   hasta el próximo trabajo programado, así una base "serverless" puede suspenderse.
 */
export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private runningGroups = new Set<string>();
  private runningJobs = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private timerAt = 0;
  private ticking = false;
  private tickAgain = false;
  private started = false;
  private stopping = false;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private concurrency = 4) {}

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: unknown, opts: EnqueueOptions = {}): Promise<string> {
    const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
    if (opts.dedupeKey) {
      const existing = await prisma.job.findFirst({
        where: { dedupeKey: opts.dedupeKey, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        if (opts.debounce) {
          await prisma.job.update({ where: { id: existing.id }, data: { runAt, payload: payload as object } });
          this.wakeAt(runAt);
        }
        return existing.id;
      }
    }
    const job = await prisma.job.create({
      data: {
        type,
        payload: payload as object,
        runAt,
        groupKey: opts.groupKey ?? null,
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? 5,
      },
    });
    this.wakeAt(runAt);
    return job.id;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    // Instancia única: cualquier trabajo "RUNNING" al arrancar quedó interrumpido por un reinicio.
    const recovered = await prisma.job.updateMany({
      where: { status: "RUNNING" },
      data: { status: "PENDING", lockedAt: null },
    });
    if (recovered.count > 0) logger.warn({ count: recovered.count }, "Trabajos interrumpidos recuperados");
    await this.cleanup();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 24 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.tick();
  }

  async stop(timeoutMs = 20_000) {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.timer = null;
    const pending = [...this.runningJobs.values()];
    await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Para pruebas: procesa todo lo que esté listo y espera a que termine. */
  async drain(maxRounds = 50) {
    for (let i = 0; i < maxRounds; i++) {
      const claimed = await this.fillSlots();
      const running = [...this.runningJobs.values()];
      if (claimed === 0 && running.length === 0) return;
      await Promise.allSettled(running);
    }
  }

  stats() {
    return { running: this.runningJobs.size, started: this.started };
  }

  private wakeAt(at: Date) {
    if (!this.started || this.stopping) return;
    const ms = Math.max(0, at.getTime() - Date.now());
    const target = Date.now() + ms;
    if (this.timer && this.timerAt <= target) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = target;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.tick();
      },
      Math.min(ms, MAX_TIMER_MS),
    );
  }

  private async tick() {
    if (!this.started || this.stopping) return;
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        await this.fillSlots();
      } while (this.tickAgain);
      await this.scheduleNext();
    } catch (err) {
      logger.error({ err }, "Error en la cola de trabajos");
      // Reintentar más tarde si la base de datos no está disponible.
      this.wakeAt(new Date(Date.now() + 30_000));
    } finally {
      this.ticking = false;
    }
  }

  /** Toma trabajos listos hasta llenar la concurrencia. Devuelve cuántos tomó. */
  private async fillSlots(): Promise<number> {
    let claimed = 0;
    while (this.runningJobs.size < this.concurrency && !this.stopping) {
      const job = await this.claimNext();
      if (!job) break;
      claimed++;
      const p = this.run(job).finally(() => {
        this.runningJobs.delete(job.id);
        if (job.groupKey) this.runningGroups.delete(job.groupKey);
        void this.tick();
      });
      this.runningJobs.set(job.id, p);
    }
    return claimed;
  }

  private async claimNext(): Promise<Job | null> {
    const busy = [...this.runningGroups];
    const rows = await prisma.$queryRaw<Job[]>`
      UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
      WHERE id = (
        SELECT j.id FROM "Job" j
        WHERE j.status = 'PENDING' AND j."runAt" <= now()
          AND (j."groupKey" IS NULL OR (
            NOT (j."groupKey" = ANY(${busy}::text[]))
            AND NOT EXISTS (SELECT 1 FROM "Job" r WHERE r.status = 'RUNNING' AND r."groupKey" = j."groupKey")
          ))
        ORDER BY j."runAt" ASC, j."createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    const job = rows[0] ?? null;
    if (job?.groupKey) this.runningGroups.add(job.groupKey);
    return job;
  }

  private async scheduleNext() {
    const next = await prisma.job.findFirst({
      where: { status: "PENDING" },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    });
    if (next) this.wakeAt(next.runAt > new Date() ? next.runAt : new Date(Date.now() + 1000));
  }

  private async run(job: Job) {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: `Sin manejador para "${job.type}"`, finishedAt: new Date() },
      });
      return;
    }
    try {
      await handler(job.payload, job);
      await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), lockedAt: null } });
    } catch (err) {
      const retryable = !(err instanceof NonRetryableError) && job.attempts < job.maxAttempts;
      const message = errorMessage(err).slice(0, 2000);
      if (retryable) {
        // Reintento con espera exponencial: 5s, 20s, 80s, 5min, 20min… (máx. 1h)
        const delay = Math.min(5000 * 4 ** (job.attempts - 1), 60 * 60 * 1000);
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "PENDING", runAt: new Date(Date.now() + delay), lastError: message, lockedAt: null },
        });
        logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, delay }, `Trabajo fallido, se reintentará: ${message}`);
      } else {
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: message, finishedAt: new Date(), lockedAt: null },
        });
        // Los NonRetryableError ya los registra el manejador con un mensaje claro.
        if (!(err instanceof NonRetryableError)) await logError("QUEUE", err, { jobId: job.id, type: job.type, attempts: job.attempts });
      }
    }
  }

  private async cleanup() {
    try {
      const day = 24 * 60 * 60 * 1000;
      await prisma.job.deleteMany({ where: { status: "DONE", finishedAt: { lt: new Date(Date.now() - 3 * day) } } });
      await prisma.job.deleteMany({ where: { status: "FAILED", finishedAt: { lt: new Date(Date.now() - 30 * day) } } });
      await prisma.errorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * day) } } });
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (err) {
      logger.error({ err }, "Error limpiando registros antiguos");
    }
  }
}
