declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    VIBES_MODE?: "AUTO" | "DIRECT_API" | "BROWSER_BRIDGE" | "MANUAL";
    VIBES_API_BASE_URL?: string;
    VIBES_API_TOKEN?: string;
    VIBES_BRIDGE_URL?: string;
    VIBES_BRIDGE_TOKEN?: string;
  }
}
