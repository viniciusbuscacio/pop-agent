export type UiCommandKind = 'state' | 'press' | 'dblclick' | 'key' | 'input' | 'screenshot';
export interface UiCommandDTO { id: string; kind: UiCommandKind; expiresAt: number; testid?: string; index?: number; value?: string; key?: string }
export interface UiSessionDTO { id: string; name: string; lastSeen: number }
export interface UiControlDTO { testid: string; index: number; role: string; name: string; disabled: boolean; value?: string }
export interface UiStateDTO { url: string; title: string; width: number; height: number; controls: UiControlDTO[]; text: string; screenshotAvailable: boolean; pendingRequests: number }
export interface UiReplyDTO { state?: UiStateDTO; png?: string; error?: { code: string; message: string } }
