/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_ENABLE_REAL_BACKEND?: string;
    readonly VITE_OPENROUTER_API_KEY?: string;
    readonly VITE_OPENROUTER_MODEL?: string;
    readonly VITE_OPENROUTER_FALLBACK_MODEL?: string;
    readonly VITE_OPENROUTER_SYSTEM_PROMPT?: string;
    readonly VITE_APP_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export {};
