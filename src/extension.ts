import * as path from 'node:path';
import * as vscode from 'vscode';
import { extractDocBlocks } from './parser';
import { renderHtml } from './renderer';

/** 插件配置命名空间 */
const CONFIG_NAMESPACE = 'componentDocPreview';

/** 插件激活入口, 注册侧边栏视图和刷新命令 */
export function activate(context: vscode.ExtensionContext) {
  /** 当前文件组件文档侧边栏提供器 */
  const provider = new ComponentDocViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ComponentDocViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('componentDocPreview.refresh', () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      /** 当前激活编辑器对应的文档 */
      const activeDocument = vscode.window.activeTextEditor?.document;

      if (activeDocument?.uri.toString() === event.document.uri.toString()) {
        provider.refreshDebounced();
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_NAMESPACE)) {
        provider.refresh();
      }
    }),
  );
}

/** 插件停用回调, 当前没有需要主动释放的资源 */
export function deactivate() {}

/** 当前文件组件文档侧边栏 Webview 提供器 */
class ComponentDocViewProvider implements vscode.WebviewViewProvider {
  /** package.json 中注册的 Webview View id */
  static readonly viewType = 'componentDocPreview.view';

  /** 当前已经解析出的侧边栏视图实例 */
  private view?: vscode.WebviewView;

  /** 防抖刷新定时器 */
  private refreshTimer?: NodeJS.Timeout;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** VS Code 创建侧边栏视图时调用, 用于初始化 Webview 能力和首屏内容 */
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.configureWebview();
    this.refresh();
  }

  /** 立即根据当前激活文件刷新侧边栏文档 */
  refresh() {
    if (!this.view) {
      return;
    }

    this.configureWebview();

    /** 当前激活的文本编辑器 */
    const editor = vscode.window.activeTextEditor;
    /** 当前配置允许扫描的文件扩展名 */
    const configuredFileExtensions = this.getConfiguredFileExtensions();
    /** 当前激活文件是否属于可扫描的文件类型 */
    const isSupportedDocument = editor ? this.isSupportedDocument(editor.document, configuredFileExtensions) : false;
    /** 当前激活文件提取出的文档块 */
    const docBlocks = editor && isSupportedDocument
      ? extractDocBlocks(editor.document.getText(), {
          tags: this.getConfiguredTags(),
        })
      : [];
    /** 当前无文档块时展示给用户的状态说明 */
    const emptyMessage = editor && !isSupportedDocument
      ? `当前文件扩展名未启用组件文档预览, 已启用: ${configuredFileExtensions.join(', ')}`
      : undefined;

    this.view.webview.html = renderHtml({
      webview: this.view.webview,
      documentUri: editor?.document.uri,
      docBlocks,
      tags: this.getConfiguredTags(),
      emptyMessage,
    });
  }

  /** 编辑文件时按配置防抖刷新侧边栏文档 */
  refreshDebounced() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    /** 文件编辑后的防抖刷新间隔 */
    const debounceMs = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<number>('debounceMs', 300);

    this.refreshTimer = setTimeout(() => {
      this.refresh();
    }, debounceMs);
  }

  /** 配置 Webview 的脚本权限和本地资源访问范围 */
  private configureWebview() {
    if (!this.view) {
      return;
    }

    /** 当前激活编辑器对应的文档 */
    const activeDocument = vscode.window.activeTextEditor?.document;
    /** 当前文件所在目录, 用于允许相对图片在 Webview 中加载 */
    const activeDocumentDir = activeDocument ? vscode.Uri.file(path.dirname(activeDocument.uri.fsPath)) : undefined;
    /** 当前工作区根目录列表, 用于允许工作区内图片资源加载 */
    const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];

    this.view.webview.options = {
      enableScripts: false,
      localResourceRoots: [this.extensionUri, activeDocumentDir, ...workspaceRoots].filter(Boolean) as vscode.Uri[],
    };
  }

  /** 读取用户配置的 JSDoc 自定义标签列表 */
  private getConfiguredTags() {
    /** 用户配置中的可渲染 JSDoc 标签 */
    const configuredTags = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string[]>('tags', [
      'componentDoc',
      'logicDoc',
    ]);

    return configuredTags.map((tag) => tag.trim()).filter(Boolean);
  }

  /** 读取用户配置的可扫描文件扩展名列表 */
  private getConfiguredFileExtensions() {
    /** 用户配置中的可扫描文件扩展名 */
    const configuredFileExtensions = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string[]>('fileExtensions', [
      '.vue',
      '.js',
      '.ts',
    ]);

    return configuredFileExtensions
      .map((extension) => extension.trim().toLowerCase())
      .filter(Boolean)
      .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`));
  }

  /** 判断当前文档是否属于配置允许扫描的文件类型 */
  private isSupportedDocument(document: vscode.TextDocument, configuredFileExtensions: string[]) {
    if (!configuredFileExtensions.length) {
      return false;
    }

    /** 当前文档路径对应的文件扩展名 */
    const documentExtension = path.extname(document.uri.fsPath).toLowerCase();

    return configuredFileExtensions.includes(documentExtension);
  }
}
