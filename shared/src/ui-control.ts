export type UiCommandKind = 'state' | 'press' | 'dblclick' | 'key' | 'input' | 'scroll' | 'screenshot';
export interface UiCommandDTO {
  id: string;
  kind: UiCommandKind;
  expiresAt: number;
  controlId?: string;
  testid?: string;
  index?: number;
  value?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
}
export interface UiSessionDTO { id: string; name: string; lastSeen: number }
export interface UiControlDTO { controlId: string; testid?: string; index?: number; role: string; name: string; disabled: boolean; value?: string }
export interface UiStateDTO { url: string; title: string; width: number; height: number; controls: UiControlDTO[]; text: string; screenshotAvailable: boolean; pendingRequests: number }
export interface UiReplyDTO { state?: UiStateDTO; png?: string; error?: { code: string; message: string } }
