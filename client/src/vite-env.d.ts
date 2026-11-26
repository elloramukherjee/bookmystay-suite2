/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base path; defaults to the same-origin "/api/v1" (proxied to the server in development). */
  readonly VITE_API_URL?: string;
  /** Hotel shown on "/" when no slug is in the URL. */
  readonly VITE_DEFAULT_HOTEL_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
