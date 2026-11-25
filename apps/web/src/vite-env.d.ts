/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_PREVIEW?: string;
}

declare module "virtual:widget-kit" {
  const code: string;
  export default code;
}
