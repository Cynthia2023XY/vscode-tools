# Component Doc Preview

Render Markdown documentation blocks from the active source file in a VS Code sidebar.

## Supported Comment Format

```ts
/**
 * @componentDoc
 *
 * # 单活动产品组件
 *
 * ## 对外业务逻辑
 *
 * - 展示单只基金长持挑战进度
 * - 领奖成功后通知父组件
 *
 * ## 对内实现逻辑
 *
 * - 根据 activityStatus 计算顶部文案
 * - 根据订阅状态切换底部按钮
 *
 * ![image.png](https://s3-internal.cn-north-1.jdcloud-oss.com/caifu-h5/fund/info-image/2026-06-15/44326d106fb1d122b1ace62066426908.png)
 */
```

You can also use `@logicDoc` for focused documentation near a computed value, watcher, request function, or handler.

## Development

```bash
npm install
npm run compile
npm run package:vsix
```

Open this folder in VS Code, press `F5`, and use the `组件文档` activity bar item in the Extension Development Host.

## Settings

- `componentDocPreview.tags`: custom JSDoc tags to render. Defaults to `componentDoc` and `logicDoc`.
- `componentDocPreview.debounceMs`: refresh delay after editing the active file. Defaults to `300`.
- `componentDocPreview.fileExtensions`: file extensions that can be scanned. Defaults to `.vue`, `.js`, and `.ts`.
