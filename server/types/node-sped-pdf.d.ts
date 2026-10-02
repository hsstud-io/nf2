declare module 'node-sped-pdf' {
  export function DANFe(options: { xml: string }): Promise<string | Buffer | Uint8Array | { data?: string; base64?: string; pdf?: string }>;
}
