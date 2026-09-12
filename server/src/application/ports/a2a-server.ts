export interface A2aServerProtocol {
  card(origin: string): Record<string, unknown>;
  handle(body: Record<string, unknown>, origin: string, signal: AbortSignal, authorize: () => void): Promise<Record<string, unknown>>;
}
