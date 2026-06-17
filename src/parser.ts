/** 单个可渲染文档块的源码位置信息和 Markdown 内容 */
export interface DocBlock {
  /** 匹配到的 JSDoc 自定义标签名称 */
  tag: string;
  /** 文档块在源文件中的起始行号, 从1开始 */
  startLine: number;
  /** 文档块在源文件中的结束行号, 从1开始 */
  endLine: number;
  /** 自定义标签后的 Markdown 文档内容 */
  markdown: string;
}

/** 解析文档块时使用的标签配置 */
export interface ExtractDocBlocksOptions {
  /** 需要从 JSDoc 中提取并渲染的自定义标签 */
  tags: string[];
}

/** 源码中的 JSDoc 多行注释匹配表达式 */
const JSDOC_BLOCK_REGEXP = /\/\*\*[\s\S]*?\*\//g;

/** 将当前文件中的指定 JSDoc 标签内容提取为 Markdown 文档块 */
export const extractDocBlocks = (source: string, options: ExtractDocBlocksOptions): DocBlock[] => {
  if (!options.tags.length) {
    return [];
  }

  /** 当前文件内所有可渲染的文档块 */
  const docBlocks: DocBlock[] = [];

  for (const match of source.matchAll(JSDOC_BLOCK_REGEXP)) {
    /** JSDoc 注释块在完整源码中的起始位置 */
    const startIndex = match.index ?? 0;
    /** 原始 JSDoc 注释内容 */
    const rawBlock = match[0];
    /** 去掉注释符号和行首星号后的纯文本内容 */
    const cleanedBlock = cleanJsdocBlock(rawBlock);
    /** 当前注释块在文件中的起始行 */
    const startLine = countLines(source.slice(0, startIndex)) + 1;
    /** 当前注释块在文件中的结束行 */
    const endLine = startLine + countLines(rawBlock) - 1;

    for (const tag of options.tags) {
      /** 当前标签对应的 Markdown 内容 */
      const markdown = extractTaggedMarkdown(cleanedBlock, tag, options.tags);

      if (markdown) {
        docBlocks.push({
          tag,
          startLine,
          endLine,
          markdown,
        });
      }
    }
  }

  return docBlocks;
};

/** 清理 JSDoc 注释外壳, 保留可直接按 Markdown 渲染的正文 */
const cleanJsdocBlock = (block: string) =>
  block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();

/** 从单个清理后的 JSDoc 注释块中提取指定标签后的 Markdown 内容 */
const extractTaggedMarkdown = (block: string, targetTag: string, allTags: string[]) => {
  /** 按行拆分后的 JSDoc 正文 */
  const lines = block.split('\n');
  /** 目标标签所在行号 */
  const tagLineIndex = lines.findIndex((line) => line.trim() === `@${targetTag}` || line.trim().startsWith(`@${targetTag} `));

  if (tagLineIndex < 0) {
    return null;
  }

  /** 标签行中跟在标签后面的首行正文 */
  const firstLineContent = lines[tagLineIndex].trim().replace(new RegExp(`^@${escapeRegExp(targetTag)}\\s*`), '');
  /** 标签后续 Markdown 正文行 */
  const markdownLines = firstLineContent ? [firstLineContent] : [];

  for (let index = tagLineIndex + 1; index < lines.length; index += 1) {
    /** 当前 JSDoc 正文行 */
    const line = lines[index];
    /** 当前行是否已经进入另一个需要提取的文档标签 */
    const isNextKnownTag = allTags.some((tag) => line.trim() === `@${tag}` || line.trim().startsWith(`@${tag} `));

    if (isNextKnownTag) {
      break;
    }

    markdownLines.push(line);
  }

  return markdownLines.join('\n').trim();
};

/** 统计文本中的换行数量, 用于把字符偏移转换为源码行号 */
const countLines = (text: string) => (text.match(/\n/g) ?? []).length;

/** 转义标签名中的正则特殊字符 */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
