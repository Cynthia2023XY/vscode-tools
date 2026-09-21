# Component Doc Preview

在 VS Code 侧边栏实时预览源码中的 JSDoc Markdown 文档。适合把 Vue 组件说明、业务逻辑说明和项目入口说明放在代码旁边，阅读时无需反复切换到独立文档。

## 快速开始

1. 安装插件后，在 VS Code 活动栏点击 **组件文档** 图标，打开 **当前文件文档** 视图。
2. 打开一个 `.vue`、`.js` 或 `.ts` 文件，在 JSDoc 注释中加入 `@componentDoc` 或 `@logicDoc`。
3. 继续编辑文件，侧边栏会自动刷新；也可以在命令面板运行 **Component Doc Preview: Refresh**。

例如，在 Vue 组件中加入：

```vue
<script setup lang="ts">
/**
 * @componentDoc
 *
 * # 基金卡片
 *
 * 展示基金名称、净值和涨跌幅。
 *
 * ## 使用场景
 *
 * - 基金列表
 * - 自选基金页
 */

/**
 * @logicDoc
 *
 * ## 涨跌幅展示
 *
 * 正值显示上涨样式，负值显示下跌样式；无数据时显示占位符。
 */
</script>
```

打开此文件后，侧边栏会按文档块展示渲染后的标题、段落和列表。普通 JSDoc 注释不会出现在预览中；只有配置的标签会被提取。

## 效果预览

![Component Doc Preview 侧边栏渲染效果](https://cf-res-cdn.jd.com/fund/info-image/2026-09-21/0c77c343be680b3e4c3cd0683c487f5b.png)

## 文档标签

| 标签 | 用途 |
| --- | --- |
| `@componentDoc` | 描述组件或当前文件的整体功能、输入输出和使用场景。 |
| `@logicDoc` | 描述计算逻辑、监听器、请求或交互处理。 |
| `@projectDoc` | 描述当前工作区的项目级信息，显示在当前文件文档之前。 |

在工作区入口文件中使用 `@projectDoc`，例如 `src/main.ts`：

```ts
/**
 * @projectDoc
 *
 * # 项目说明
 *
 * 本项目的主要入口、环境配置和开发约定。
 */
```

插件默认依次查找 `src/main.ts`、`src/main.js`、`src/App.vue`、`src/extension.ts`，**只读取第一个存在的文件**。如果项目文档写在其他文件中，请通过 `componentDocPreview.projectDocFiles` 指定该文件，并将它放在列表最前面。

## Markdown 与图片

文档块支持标题、列表、链接、代码块、表格和图片等 Markdown 内容。出于安全考虑，注释中的原始 HTML 不会作为 HTML 渲染。

本地图片路径相对于**写有文档块的源码文件**，例如组件位于 `src/components/FundCard.vue`，图片位于 `src/components/images/example.png`：

```md
![基金卡片](./images/example.png)
```

需要指定图片宽度时，在替代文本末尾追加 `|数字`，单位为像素：

```md
![基金卡片|365](./images/example.png)
```

外部图片请使用可公开访问的 HTTPS 地址。图片展示宽度仍受侧边栏宽度限制。

## 设置

在 VS Code 设置中搜索 `Component Doc Preview`，或在工作区的 `.vscode/settings.json` 中配置：

```json
{
  "componentDocPreview.tags": ["componentDoc", "logicDoc"],
  "componentDocPreview.debounceMs": 300,
  "componentDocPreview.fileExtensions": [".vue", ".js", ".ts"],
  "componentDocPreview.projectDocFiles": ["src/main.ts", "src/main.js", "src/App.vue", "src/extension.ts"],
  "componentDocPreview.projectDocTag": "projectDoc"
}
```

| 配置项 | 作用 |
| --- | --- |
| `tags` | 当前文件中要提取的 JSDoc 标签。 |
| `debounceMs` | 编辑后自动刷新的等待时间，单位为毫秒。 |
| `fileExtensions` | 允许预览的当前文件扩展名。 |
| `projectDocFiles` | 项目文档候选文件，按顺序取第一个存在的文件。 |
| `projectDocTag` | 项目级文档使用的 JSDoc 标签。 |

## 常见问题

- **侧边栏为空：**确认已打开受支持的源码文件，注释使用 `/** ... */` 格式，且标签独占一行或写在该行开头。
- **项目文档未出现：**检查 `projectDocFiles` 的第一个存在文件是否包含 `@projectDoc`；必要时调整候选顺序。
- **图片未显示：**检查相对路径是否以源码文件所在目录为基准；外部图片应使用可访问的 HTTPS 地址。
- **修改后没有刷新：**运行 **Component Doc Preview: Refresh**，并检查文件类型是否在 `fileExtensions` 中。

## 开发

```bash
npm install
npm run compile
npm run package:vsix
```

在 VS Code 中打开本项目，按 `F5` 启动 Extension Development Host 进行调试。

## 许可证与反馈

本项目采用 [MIT 许可证](LICENSE)。问题反馈请前往 [GitHub Issues](https://github.com/Cynthia2023XY/vscode-tools/issues)。
