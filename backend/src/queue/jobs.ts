import { getQueue } from "./index.js";
import { handleReplyJob } from "../pipeline/reply.js";
import { handleSendMessage } from "../services/outbound.service.js";
import { runMemoryUpdate } from "../memory/memory.service.js";
import { logError } from "../services/errorlog.service.js";
import { describeClaudeError } from "../pipeline/reply.js";
import { NonRetryableError } from "./job-queue.js";

/** Registra los tipos de trabajo de la aplicación. */
export function registerJobs() {
  const q = getQueue();
  q.register("reply", (payload, job) => handleReplyJob(payload, job));
  q.register("send_message", (payload, job) => handleSendMessage(payload, job));
  q.register("memory_update", async (payload, job) => {
    try {
      await runMemoryUpdate(payload.contactId);
    } catch (err) {
      const { message, retryable } = describeClaudeError(err);
      if (retryable && job.attempts < job.maxAttempts) throw err;
      await logError("MEMORY", `No se pudo actualizar la memoria: ${message}`, {}, payload.contactId, "warn");
      throw new NonRetryableError(message);
    }
  });
}
