export const VERSION = '0.5.7';
export function documentTypeCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  if (/^-?\d+$/.test(text)) return Number(text);
  const named: Record<string, number> = { HOME: -1, START_PAGE: -1, STARTPAGE: -1,
    BLANK: 0, PROJECT: 5, PCB: 3, SCHEMATIC_PAGE: 1, PANEL: 26,
    PCB_2D_PREVIEW: 12, PCB_3D_PREVIEW: 15, PANEL_3D_PREVIEW: 27 };
  return named[text.toUpperCase().replace(/[\s-]+/g, '_')];
}
export function passiveTab(type: unknown, title: unknown): boolean {
  const code = documentTypeCode(type);
  if (code !== undefined && [-1, 0, 5, 12, 15, 27].includes(code)) return true;
  // Never let a user-renamed PCB/library bypass its explicit editor type.
  const editorTypes = [1, 2, 3, 4, 7, 8, 9, 17, 18, 19, 20, 21, 22, 25, 26, 29, 32];
  if (code !== undefined && editorTypes.includes(code)) return false;
  return typeof title === 'string' && ['start page', 'startpage', '开始页', '首页']
    .includes(title.trim().toLowerCase());
}
export function parseIds(input: string): string[] {
  const ids = [...new Set(input.split(/[\s,;，；、]+/).filter(Boolean).map(normalizeId))];
  if (!ids.length) throw new Error('请输入至少一个 C 编号。');
  if (ids.length > 50) throw new Error('每批最多 50 个器件，请分批下载。');
  return ids;
}
export function normalizeId(input: string): string {
  const value = input.trim().toUpperCase();
  if (!/^C[1-9]\d*$/.test(value)) throw new Error('请输入有效立创编号，例如 C48997937。');
  return value;
}
export function mmFromMil(value: number): number {
  if (!Number.isFinite(value)) throw new Error('坐标不是有效数值。');
  return value * 0.0254;
}
export function boardPolygon(box: { minX: number; minY: number; maxX: number; maxY: number }): Array<number | 'L'> {
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)
    || box.maxX < box.minX || box.maxY < box.minY) throw new Error('无法计算器件边框。');
  const margin = 5 / 0.0254;
  const x0 = box.minX - margin, y0 = box.minY - margin;
  const x1 = box.maxX + margin, y1 = box.maxY + margin;
  return [x0, y0, 'L', x1, y0, x1, y1, x0, y1, x0, y0];
}
export function assertSingleComponent<T>(components: T[]): T {
  if (components.length !== 1) throw new Error(`当前 PCB 有 ${components.length} 个器件，要求恰好一个。`);
  return components[0];
}
export function assertTopZeroRotation(layer: number, rotation: number): void {
  if (layer !== 1) throw new Error('第一版只处理顶层器件。');
  if (!Number.isFinite(rotation) || Math.abs(((rotation % 360) + 360) % 360) > 1e-8)
    throw new Error('第一版要求封装旋转为 0°。请在 PCB 中调整后再导出。');
}
