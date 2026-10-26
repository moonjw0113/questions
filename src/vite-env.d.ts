/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare module 'virtual:study-content' {
  export const schema: Record<string, unknown>;
  export const biology: unknown;
  export const generationPrompt: string;
  export const analysisPrompt: string;
}
