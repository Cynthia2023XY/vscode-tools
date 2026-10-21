/** Node 内置断言, 验证预览内容和文件归属 */
const assert = require('node:assert/strict');
/** 临时项目文件读写工具 */
const fs = require('node:fs');
/** 临时工作区所在系统目录 */
const os = require('node:os');
/** 跨平台文件路径工具 */
const path = require('node:path');
/** 扩展加载时注入 VS Code 测试接口 */
const Module = require('node:module');
/** Node 内置测试入口 */
const { test } = require('node:test');

/** 模拟包含 Git 版本参数的 VS Code 文件地址 */
function uri(filePath, scheme = 'file', query = '') {
  return { fsPath: filePath, scheme, toString: () => `${scheme}:${filePath}?${query}` };
}

/** 模拟可直接读取未保存内容的编辑器文档 */
function document(address, text) {
  return { uri: address, getText: () => text };
}

/** 模拟文本对比标签页, 保留原始侧与修改侧地址 */
class TabInputTextDiff {
  /** 初始化对比两侧对应的文件版本 */
  constructor(original, modified) {
    this.original = original;
    this.modified = modified;
  }
}

/** 覆盖无编辑器、跨文件类型、Git 对比与异步文件切换 */
test('项目文档常驻与对比文件预览回归', async () => {
  // 创建独立工作区, 不依赖开发者实际打开的项目
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-doc-preview-'));
  // 记录订阅回调, 模拟标签页和编辑器事件
  const events = {};
  // 保存侧边栏提供器以触发刷新
  let provider;
  // 每个刷新事件都返回可释放的订阅
  const subscribe = (name) => (callback) => {
    events[name] = callback;
    return { dispose() {} };
  };
  // 统一模拟项目文档路径
  const projectUri = uri(path.join(root, 'src/main.ts'));
  // 模拟当前工作区及项目文件地址
  const folder = { uri: uri(root) };
  // 虚拟文件版本内容由用例分别指定
  const documents = new Map();
  // 只模拟扩展用到的公开 VS Code 接口
  const vscode = {
    Uri: { file: (filePath) => uri(filePath) },
    TabInputTextDiff,
    window: {
      activeTextEditor: undefined,
      tabGroups: {
        activeTabGroup: { activeTab: undefined },
        onDidChangeTabs: subscribe('tabs'),
        onDidChangeTabGroups: subscribe('groups'),
      },
      registerWebviewViewProvider: (_type, value) => {
        provider = value;
        return { dispose() {} };
      },
      onDidChangeActiveTextEditor: subscribe('editor'),
    },
    workspace: {
      workspaceFolders: [folder],
      textDocuments: [],
      getWorkspaceFolder: (address) => address.scheme === 'file' && address.fsPath.startsWith(`${root}/`) ? folder : undefined,
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      openTextDocument: async (address) => {
        if (!documents.has(address.toString())) throw new Error('文件不存在');
        return documents.get(address.toString());
      },
      onDidChangeTextDocument: subscribe('text'),
      onDidChangeConfiguration: subscribe('config'),
      onDidChangeWorkspaceFolders: subscribe('workspace'),
    },
    commands: { registerCommand: subscribe('command') },
  };
  // 复用真实 Markdown 渲染, 只替换宿主接口
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args);
  };
  // 侧边栏最终 HTML 可供断言
  const view = { webview: { cspSource: 'test', asWebviewUri: (address) => address, html: '' } };

  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(projectUri.fsPath, '/** @projectDoc\n * 项目全局说明\n */');
    require('../out/extension').activate({ extensionUri: uri(root), subscriptions: [] });
    provider.resolveWebviewView(view);
    await provider.refresh();
    assert.match(view.webview.html, /项目全局说明/);

    for (const filePath of [path.join(root, 'config.json'), '/outside/readme.md']) {
      vscode.window.activeTextEditor = { document: document(uri(filePath), '{}') };
      await provider.refresh();
      assert.match(view.webview.html, /项目全局说明/);
    }

    // 对比视图没有文本编辑器时应读取修改侧的 Git 虚拟版本
    const original = uri(path.join(root, 'src/card.vue'), 'git', 'HEAD');
    const modified = uri(path.join(root, 'src/card.vue'), 'git', 'index');
    documents.set(original.toString(), document(original, '/** @componentDoc\n * 原始组件说明\n */'));
    documents.set(modified.toString(), document(modified, '/** @logicDoc\n * 暂存版本说明\n * ![图](./images/card.png)\n */'));
    vscode.window.activeTextEditor = undefined;
    vscode.window.tabGroups.activeTabGroup.activeTab = { input: new TabInputTextDiff(original, modified) };
    await provider.refresh();
    assert.match(view.webview.html, /暂存版本说明/);
    assert.match(view.webview.html, /项目全局说明/);
    assert.match(view.webview.html, /src\/images\/card.png/);
    assert.doesNotMatch(view.webview.html, /当前文件没有找到/);

    // 焦点位于原始侧时展示原始侧文档
    vscode.window.activeTextEditor = { document: documents.get(original.toString()) };
    await provider.refresh();
    assert.match(view.webview.html, /原始组件说明/);
    assert.doesNotMatch(view.webview.html, /暂存版本说明/);

    // 删除文件的修改侧不可读取时回退原始侧
    vscode.window.activeTextEditor = undefined;
    documents.delete(modified.toString());
    await provider.refresh();
    assert.match(view.webview.html, /原始组件说明/);

    // Git 入口文件的历史内容不应覆盖工作区未保存的项目说明
    vscode.workspace.textDocuments = [document(projectUri, '/** @projectDoc\n * 未保存项目说明\n */')];
    vscode.window.activeTextEditor = { document: document(uri(projectUri.fsPath, 'git', 'HEAD'), '/** @projectDoc\n * 历史项目说明\n */') };
    await provider.refresh();
    assert.match(view.webview.html, /未保存项目说明/);
    assert.doesNotMatch(view.webview.html, /历史项目说明/);

    // 较慢的旧对比版本读取完成后不得覆盖新激活的文件
    let finishRead;
    documents.set(modified.toString(), new Promise((resolve) => { finishRead = resolve; }));
    vscode.window.activeTextEditor = undefined;
    const pending = provider.refresh();
    vscode.window.tabGroups.activeTabGroup.activeTab = undefined;
    vscode.window.activeTextEditor = { document: document(uri(path.join(root, 'new.ts')), '/** @logicDoc\n * 新文件说明\n */') };
    await provider.refresh();
    finishRead(document(modified, '/** @logicDoc\n * 过期版本说明\n */'));
    await pending;
    assert.match(view.webview.html, /新文件说明/);
    assert.doesNotMatch(view.webview.html, /过期版本说明/);

    // 标签页切换和工作区变化均已注册刷新事件
    assert.equal(typeof events.tabs, 'function');
    assert.equal(typeof events.groups, 'function');
    assert.equal(typeof events.workspace, 'function');
  } finally {
    Module._load = originalLoad;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
