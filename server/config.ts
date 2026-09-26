import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
export const env = {
  hosted: process.env.PROOFLAYER_HOSTED === "true",
  port: Number(process.env.SERVICE_PORT || 8792),
  harness: process.env.TRUEFORGE_INTERNAL_URL || "http://127.0.0.1:8790",
  model: process.env.OPENAI_MODEL || "gpt-6-sol",
  dataDir: process.env.PROOFLAYER_DATA_DIR || ".data",
};
