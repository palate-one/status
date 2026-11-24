export type Env = Pick<Cloudflare.Env, "DB" | "ASSETS"> & {
  STATUS_READ_LIMITER: RateLimit;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};
