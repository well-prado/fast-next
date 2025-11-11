import type { Job } from "bullmq";
import { queueService } from "../services/queue.service";
import { emailQueue, type EmailPayload } from "../queues/email.queue";

queueService.registerWorker<EmailPayload>(emailQueue.name, async (job: Job<EmailPayload>) => {
  const { to, subject, body } = job.data;
    console.log("[worker] sending email to " + to + ": " + subject);
  console.log(body);
  return { deliveredAt: Date.now() };
});
