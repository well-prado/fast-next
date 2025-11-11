import { queueService } from "../services/queue.service";

export type EmailPayload = {
  to: string;
  subject: string;
  body: string;
};

export const emailQueue = queueService.registerQueue<EmailPayload>("email");

export async function enqueueEmail(payload: EmailPayload) {
  return emailQueue.add("send-email", payload, {
    priority: 1,
  });
}
