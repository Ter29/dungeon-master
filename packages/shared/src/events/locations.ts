export type LocationBackground = { id: string; url: string; width: number; height: number; mimeType: string; byteSize: number };
export type LocationView = { id: string; name: string; description: string; revision: number; background: LocationBackground | null };
export type LocationSnapshot = { version: number; scene: LocationView | null };
