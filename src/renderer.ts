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

/** 渲染侧边栏文档时需要的上下文参数 */
export interface RenderHtmlOptions {
  /** 当前侧边栏 Webview 实例 */
  webview: vscode.Webview;
  /** 当前正在展示文档的源码文件 URI */
  documentUri?: vscode.Uri;
  /** 当前文件提取出的文档块 */
  docBlocks: DocBlock[];
  /** 当前启用的自定义标签 */
  tags: string[];
  /** 当前文件无可渲染文档时展示的空状态文案 */
  emptyMessage?: string;
}

/** 将当前文件的文档块渲染为完整 Webview HTML */
export const renderHtml = (options: RenderHtmlOptions) => {
  /** Webview 内容安全策略使用的随机 nonce */
  const nonce = createNonce();
  /** 侧边栏主内容 HTML */
  const content = options.documentUri
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
  if (!options.docBlocks.length) {
    return renderEmptyState(options.emptyMessage ?? `当前文件没有找到 @${options.tags.join(' / @')} 文档块`);
  }

  return options.docBlocks
    .map((docBlock) => {
      /** 重写图片路径后的 Markdown 文本 */
      const markdown = rewriteMarkdownImagePaths(docBlock.markdown, options.webview, options.documentUri);
      /** Markdown 渲染后的 HTML 片段 */
      const html = markdownRenderer.render(markdown);

      return `<section class="doc-block">
  <div class="doc-meta">@${escapeHtml(docBlock.tag)} · lines ${docBlock.startLine}-${docBlock.endLine}</div>
  ${html}
</section>`;
    })
    .join('\n');
};

/** 渲染空状态说明 */
const renderEmptyState = (message: string) => `<p class="empty-state">${escapeHtml(message)}</p>`;

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
