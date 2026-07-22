import * as path from 'node:path';
import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import type { DocBlock } from './parser';

/** Markdown 渲染器实例, 用于将文档块转换为 Webview HTML */
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

/** 默认图片渲染函数, 用于保留 markdown-it 原有的图片输出能力 */
const defaultImageRenderer =
  markdownRenderer.renderer.rules.image ??
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

/** 处理图片 alt 中的宽度约定, 让 image.png|365 渲染为指定宽度图片 */
markdownRenderer.renderer.rules.image = (tokens, index, options, env, self) => {
  /** 当前待渲染的图片 token */
  const token = tokens[index];
  /** 图片 alt 中解析出的展示文本和尺寸配置 */
  const imageMeta = parseImageAltMeta(token.content);

  token.content = imageMeta.alt;

  if (Array.isArray(token.children) && token.children.length) {
    token.children[0].content = imageMeta.alt;
  }

  if (imageMeta.width) {
    token.attrSet('width', imageMeta.width);
  }

  return defaultImageRenderer(tokens, index, options, env, self);
};

/** Webview 渲染时带有来源文件信息的文档块 */
export interface RenderableDocBlock extends DocBlock {
  /** 文档块所在的源文件 URI, 用于解析相对图片路径 */
  documentUri?: vscode.Uri;
  /** 文档块来源文件展示名称, 用于区分项目文档和当前文件文档 */
  sourceLabel?: string;
}

/** 渲染侧边栏文档时需要的上下文参数 */
export interface RenderHtmlOptions {
  /** 当前侧边栏 Webview 实例 */
  webview: vscode.Webview;
  /** 当前正在展示文档的源码文件 URI */
  documentUri?: vscode.Uri;
  /** 当前文件提取出的文档块 */
  docBlocks: RenderableDocBlock[];
  /** 当前工作区提取出的项目级文档块 */
  projectDocBlocks?: RenderableDocBlock[];
  /** 当前启用的自定义标签 */
  tags: string[];
  /** 当前文件无可渲染文档时展示的空状态文案 */
  emptyMessage?: string;
}

/** 将当前文件的文档块渲染为完整 Webview HTML */
export const renderHtml = (options: RenderHtmlOptions) => {
  /** Webview 内容安全策略使用的随机 nonce */
  const nonce = createNonce();
  /** 当前是否存在可渲染的项目级文档 */
  const hasProjectDocBlocks = Boolean(options.projectDocBlocks?.length);
  /** 侧边栏主内容 HTML */
  const content = options.documentUri || hasProjectDocBlocks
    ? renderDocumentContent(options)
    : renderEmptyState('当前没有打开可读取的文件');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.webview.cspSource} https: data:; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body {
      box-sizing: border-box;
      padding: 12px;
      margin: 0;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.6;
    }

    h1,
    h2,
    h3,
    h4 {
      line-height: 1.35;
    }

    h1 {
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    a {
      color: var(--vscode-textLink-foreground);
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 8px 0;
      border-radius: 4px;
    }

    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.95em;
    }

    pre {
      padding: 10px;
      overflow: auto;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
    }

    blockquote {
      padding-left: 10px;
      margin-left: 0;
      color: var(--vscode-descriptionForeground);
      border-left: 3px solid var(--vscode-panel-border);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 4px 6px;
      border: 1px solid var(--vscode-panel-border);
    }

    .doc-block {
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .doc-block:last-child {
      border-bottom: 0;
    }

    .project-doc-block {
      padding: 10px;
      margin-bottom: 16px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
    }

    .doc-meta,
    .empty-state {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
};

/** 渲染当前文件的文档块列表 */
const renderDocumentContent = (options: RenderHtmlOptions) => {
  /** 当前工作区项目级文档块 */
  const projectDocBlocks = options.projectDocBlocks ?? [];

  if (!projectDocBlocks.length && !options.docBlocks.length) {
    return renderEmptyState(options.emptyMessage ?? `当前文件没有找到 @${options.tags.join(' / @')} 文档块`);
  }

  return [
    ...projectDocBlocks.map((docBlock) => renderDocBlock(docBlock, options, 'doc-block project-doc-block')),
    ...options.docBlocks.map((docBlock) => renderDocBlock(docBlock, options, 'doc-block')),
  ]
    .join('\n');
};

/** 渲染空状态说明 */
const renderEmptyState = (message: string) => `<p class="empty-state">${escapeHtml(message)}</p>`;

/** 渲染单个文档块内容和来源元信息 */
const renderDocBlock = (docBlock: RenderableDocBlock, options: RenderHtmlOptions, className: string) => {
  /** 当前文档块用于解析相对资源的来源文件 URI */
  const documentUri = docBlock.documentUri ?? options.documentUri;
  /** 重写图片路径后的 Markdown 文本 */
  const markdown = rewriteMarkdownImagePaths(docBlock.markdown, options.webview, documentUri);
  /** Markdown 渲染后的 HTML 片段 */
  const html = markdownRenderer.render(markdown);
  /** 文档块来源元信息文案 */
  const meta = docBlock.sourceLabel
    ? `@${docBlock.tag} · ${docBlock.sourceLabel} · lines ${docBlock.startLine}-${docBlock.endLine}`
    : `@${docBlock.tag} · lines ${docBlock.startLine}-${docBlock.endLine}`;

  return `<section class="${escapeHtml(className)}">
  <div class="doc-meta">${escapeHtml(meta)}</div>
  ${html}
</section>`;
};

/** 将 Markdown 中的本地图片路径转换为 Webview 可访问路径 */
const rewriteMarkdownImagePaths = (markdown: string, webview: vscode.Webview, documentUri?: vscode.Uri) =>
  markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_match, alt: string, src: string, title?: string) => {
    if (!documentUri || isExternalResource(src)) {
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }

    /** 当前源码文件所在目录 */
    const documentDir = path.dirname(documentUri.fsPath);
    /** 按当前文件目录解析后的本地图片 URI */
    const imageUri = vscode.Uri.file(path.resolve(documentDir, decodeURIComponent(src)));
    /** Webview 沙箱内可访问的图片 URI */
    const webviewUri = webview.asWebviewUri(imageUri).toString();

    return title ? `![${alt}](${webviewUri} "${title}")` : `![${alt}](${webviewUri})`;
  });

/** 判断资源是否已经是 Webview 可直接访问的外部或内联资源 */
const isExternalResource = (src: string) => /^(https?:|data:|vscode-resource:|vscode-webview-resource:)/i.test(src);

/** 解析图片 alt 中约定的尺寸后缀, 例如 image.png|365 表示宽度 365 */
const parseImageAltMeta = (alt: string) => {
  /** 图片 alt 文本与宽度后缀的匹配结果 */
  const match = alt.match(/^(.*)\|(\d+)$/);

  if (!match) {
    return {
      alt,
    };
  }

  /** 图片语义说明文本, 会继续作为 img 的 alt 属性 */
  const imageAlt = match[1].trim();
  /** 图片期望展示宽度, 用于写入 img 的 width 属性 */
  const width = match[2];

  return {
    alt: imageAlt,
    width,
  };
};

/** 生成内容安全策略需要的随机 nonce */
const createNonce = () => {
  /** 可用于 nonce 的字符表 */
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  /** 当前生成的 nonce 字符串 */
  let text = '';

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
};

/** 转义 HTML 特殊字符, 避免空状态和元信息破坏页面结构 */
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
