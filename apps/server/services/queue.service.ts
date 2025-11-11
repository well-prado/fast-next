import { Queue, Worker, QueueScheduler, type JobsOptions, type QueueOptions, type WorkerOptions, type Job } from "bullmq";
import IORedis from "ioredis";

type QueueConfig = QueueOptions & {
  defaultJobOptions?: JobsOptions;
};

const sharedConnection = new IORedis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

export class QueueService {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private schedulers = new Map<string, QueueScheduler>();

  constructor(private readonly connectionFactory = () => sharedConnection.duplicate()) {}

  registerQueue<T = unknown>(name: string, options?: QueueConfig) {
    if (this.queues.has(name)) {
      return this.queues.get(name) as Queue<T>;
    }

    const queue = new Queue<T>(name, {
      connection: this.connectionFactory(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
      ...options,
    });

    const scheduler = new QueueScheduler(name, {
      connection: this.connectionFactory(),
    });

    this.queues.set(name, queue);
    this.schedulers.set(name, scheduler);
    return queue;
  }

  registerWorker<T = unknown>(
    name: string,
    processor: (job: Job<T>) => Promise<unknown>,
    options?: WorkerOptions
  ) {
    if (!this.queues.has(name)) {
      this.registerQueue<T>(name);
    }

    const worker = new Worker<T>(name, processor, {
      connection: this.connectionFactory(),
      concurrency: 5,
      ...options,
    });

    worker.on("completed", (job) => {
      console.log("[queue:" + name + "] job " + job.id + " completed");
    });

    worker.on("failed", (job, error) => {
      console.error("[queue:" + name + "] job " + (job?.id ?? "unknown") + " failed", error);
    });

    this.workers.set(name, worker);
    return worker;
  }
}

export const queueService = new QueueService();
