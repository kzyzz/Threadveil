# Threadveil

Threadveil 是一个用于 X/Twitter 的 Chrome 插件，主要用来屏蔽中文黄推、引流号、垃圾回复和低质量评论。

它会在本地根据关键词、正则规则和简单评分机制隐藏可疑回复，让推文详情页更干净。

## 安装

这个插件不走 Chrome 商店，手动导入即可。

1. 下载或克隆这个仓库。
2. 打开 `chrome://extensions/`。
3. 开启右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择本项目文件夹。
6. 刷新 X/Twitter 页面。

## 功能

- 屏蔽中文黄推、引流号、垃圾回复。
- 支持自定义关键词。
- 支持自定义正则规则。
- 支持调整屏蔽阈值、规则权重和默认规则库。
- 支持调试模式，方便查看命中原因。

## 隐私

Threadveil 只在你的浏览器本地运行。

你的规则、关键词和设置保存在 Chrome 扩展存储里，不会上传到服务器。

## 开发

快速检查脚本语法：

```bash
node --check content.js
node --check media-sniffer.js
node --check background.js
```

## License

MIT
