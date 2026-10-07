/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the realtime server listens. Defaults to port 2567 of the page's host. */
  readonly VITE_REALTIME_URL?: string;
}
