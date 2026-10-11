/**
 * 快速 32 位 FNV-1a 哈希算法，用于高效计算原文文本 Hash
 */
export function fastTextHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

/**
 * 为段落节点生成全局稳定的唯一标识
 */
export function generateSegmentId(index: number, text: string): string {
  const hash = fastTextHash(text.trim());
  return `seg-${index}-${hash.slice(0, 8)}`;
}
