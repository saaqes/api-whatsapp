import { env } from "../config/env.js";
import { JobQueue } from "./job-queue.js";

let queue: JobQueue | null = null;

export function getQueue(): JobQueue {
  if (!queue) queue = new JobQueue(env.JOB_CONCURRENCY);
  return queue;
}
