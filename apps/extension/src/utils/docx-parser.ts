/**
 * 零外部依赖原生 DOCX 段落解析器
 * 利用现代浏览器原生 DecompressionStream('deflate-raw') 解压 word/document.xml
 */

export interface ParsedDocumentParagraph {
  id: string;
  originalText: string;
  translatedText?: string;
}

export async function parseDocxFile(file: File): Promise<ParsedDocumentParagraph[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 1. 查找 ZIP Central Directory 或 Local File Header 中 word/document.xml
  const xmlContent = await extractFileFromZip(bytes, 'word/document.xml');
  if (!xmlContent) {
    throw new Error('无法在 DOCX 压缩包中找到 word/document.xml，可能是损坏的文件或非标准格式');
  }

  // 2. 解析 XML 提取 <w:p> 段落
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
  const pNodes = xmlDoc.getElementsByTagName('w:p');

  const paragraphs: ParsedDocumentParagraph[] = [];
  let index = 0;

  for (let i = 0; i < pNodes.length; i++) {
    const p = pNodes[i];
    // 获取段落中所有的 <w:t> 文本节点
    const tNodes = p.getElementsByTagName('w:t');
    let text = '';
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes[j].textContent || '';
    }

    const trimmed = text.trim();
    if (trimmed.length > 0) {
      paragraphs.push({
        id: `p-${++index}`,
        originalText: trimmed,
      });
    }
  }

  return paragraphs;
}

export async function parseTxtFile(file: File): Promise<ParsedDocumentParagraph[]> {
  const text = await file.text();
  const rawLines = text.split(/\r?\n+/);
  const paragraphs: ParsedDocumentParagraph[] = [];
  let index = 0;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      paragraphs.push({
        id: `p-${++index}`,
        originalText: trimmed,
      });
    }
  }

  return paragraphs;
}

/**
 * 极简 ZIP 解析与解压，定位特定文件名
 */
async function extractFileFromZip(bytes: Uint8Array, targetPath: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 30 < bytes.length) {
    // Local file header signature = 0x04034b50
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      break;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLength);
    const fileName = new TextDecoder('utf-8').decode(fileNameBytes);

    const dataStart = offset + 30 + fileNameLength + extraFieldLength;

    if (fileName === targetPath) {
      const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        // 无压缩
        return new TextDecoder('utf-8').decode(compressedData);
      } else if (compressionMethod === 8) {
        // Deflate 压缩
        const decompressed = await decompressDeflateRaw(compressedData);
        return new TextDecoder('utf-8').decode(decompressed);
      } else {
        throw new Error(`不支持的 ZIP 压缩方式: ${compressionMethod}`);
      }
    }

    offset = dataStart + compressedSize;
  }

  return null;
}

async function decompressDeflateRaw(compressedBytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    await writer.write(compressedBytes as any);
    await writer.close();

    const response = new Response(ds.readable);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  throw new Error('当前浏览器环境不支持 DecompressionStream');
}
