import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { extractDocBlocks, type DocBlock } from './parser';
import { renderHtml } from './renderer';

/** 插件配置命名空间 */
const CONFIG_NAMESPACE = 'componentDocPreview';

/** 默认项目文档候选文件, 优先复用项目已有入口或根组件文件 */
const DEFAULT_PROJECT_DOC_FILES = ['src/main.ts', 'src/main.js', 'src/App.vue', 'src/extension.ts'];

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

      if (activeDocument?.uri.toString() === event.document.uri.toString() || provider.isProjectDocDocument(event.document)) {
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
        }).map((docBlock) => this.createRenderableDocBlock(docBlock, editor.document.uri))
      : [];
    /** 当前工作区项目级文档块 */
    const projectDocBlocks = this.getProjectDocBlocks(editor?.document);
    /** 当前无文档块时展示给用户的状态说明 */
    const emptyMessage = editor && !isSupportedDocument
      ? `当前文件扩展名未启用组件文档预览, 已启用: ${configuredFileExtensions.join(', ')}`
      : undefined;

    this.view.webview.html = renderHtml({
      webview: this.view.webview,
      documentUri: editor?.document.uri,
      docBlocks,
      projectDocBlocks,
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

  /** 读取项目级文档所在的工作区相对路径候选列表 */
  private getConfiguredProjectDocFiles() {
    /** 用户配置中的项目级文档文件路径候选列表 */
    const configuredProjectDocFiles = vscode.workspace
      .getConfiguration(CONFIG_NAMESPACE)
      .get<string[]>('projectDocFiles', DEFAULT_PROJECT_DOC_FILES);

    return configuredProjectDocFiles.map((file) => file.trim()).filter(Boolean);
  }

  /** 读取项目级文档使用的 JSDoc 标签名称 */
  private getConfiguredProjectDocTag() {
    /** 用户配置中的项目级文档标签 */
    const configuredProjectDocTag = vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get<string>('projectDocTag', 'projectDoc');

    return configuredProjectDocTag.trim() || 'projectDoc';
  }

  /** 读取当前工作区的项目级文档块 */
  private getProjectDocBlocks(activeDocument?: vscode.TextDocument) {
    /** 当前项目级文档所在工作区 */
    const workspaceFolder = this.getProjectDocWorkspaceFolder(activeDocument);

    if (!workspaceFolder) {
      return [];
    }

    /** 项目级文档的完整文件 URI */
    const projectDocUri = this.getProjectDocUri(workspaceFolder);

    if (!projectDocUri) {
      return [];
    }

    /** 项目级文档文件中的原始 JSDoc 内容, 优先使用编辑器里的未保存内容 */
    const projectDocSource = activeDocument?.uri.fsPath === projectDocUri.fsPath
      ? activeDocument.getText()
      : fs.readFileSync(projectDocUri.fsPath, 'utf8');
    /** 项目级文档中提取出的 Markdown 文档块 */
    const projectDocBlocks = extractDocBlocks(projectDocSource, {
      tags: [this.getConfiguredProjectDocTag()],
    });

    return projectDocBlocks.map((docBlock) =>
      this.createRenderableDocBlock(docBlock, projectDocUri, path.relative(workspaceFolder.uri.fsPath, projectDocUri.fsPath)),
    );
  }

  /** 判断变更文档是否为当前配置的项目级文档 */
  isProjectDocDocument(document: vscode.TextDocument) {
    /** 变更文件所在的工作区 */
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    if (!workspaceFolder) {
      return false;
    }

    /** 项目级文档候选文件对应的绝对路径列表 */
    const projectDocPaths = this.getConfiguredProjectDocFiles().map((file) => path.resolve(workspaceFolder.uri.fsPath, file));

    return projectDocPaths.includes(document.uri.fsPath);
  }

  /** 获取项目级文档应该归属的工作区 */
  private getProjectDocWorkspaceFolder(activeDocument?: vscode.TextDocument) {
    if (activeDocument) {
      return vscode.workspace.getWorkspaceFolder(activeDocument.uri);
    }

    /** 当前 VS Code 打开的工作区根目录列表 */
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders?.length) {
      return undefined;
    }

    return workspaceFolders[0];
  }

  /** 从配置候选列表中查找当前工作区实际存在的项目级文档文件 */
  private getProjectDocUri(workspaceFolder: vscode.WorkspaceFolder) {
    /** 当前工作区下配置的项目级文档候选文件 */
    const projectDocFiles = this.getConfiguredProjectDocFiles();

    for (const projectDocFile of projectDocFiles) {
      /** 项目级文档候选文件的绝对路径 */
      const projectDocPath = path.resolve(workspaceFolder.uri.fsPath, projectDocFile);

      if (fs.existsSync(projectDocPath)) {
        return vscode.Uri.file(projectDocPath);
      }
    }

    return undefined;
  }

  /** 补充文档块渲染时需要的来源文件信息 */
  private createRenderableDocBlock(docBlock: DocBlock, documentUri: vscode.Uri, sourceLabel?: string) {
    return {
      ...docBlock,
      documentUri,
      sourceLabel,
    };
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
