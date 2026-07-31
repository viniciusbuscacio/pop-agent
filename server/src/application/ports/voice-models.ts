/**
 * The whisper models as the routes see them (popy.spec §14). The store on disk
 * is one adapter; the interface layer just lists and installs.
 */
export interface VoiceModelStatus {
  name: string;
  approxMb: number;
  installed: boolean;
}

export interface VoiceModelStore {
  status(): Promise<VoiceModelStatus[]>;
  /** The local path, downloading and verifying the model if missing. */
  ensure(name: string): Promise<string>;
}
