# 密电机

本机运行的信息加密工具，支持随机密码本、密文翻译及手机离线网页

## 自动发布

仓库的 `main` 分支提交更新后，GitHub Actions 会自动构建、检查并部署到 GitHub Pages

首次启用时，在仓库的 Settings → Pages → Build and deployment → Source 中选择 GitHub Actions

## 修改页面

编辑 `source.html` 并提交到 `main`，构建会自动更新脚本校验值和离线缓存版本，不需要手动修改长校验字符串

联网时获取新的页面，断网时使用已经缓存的程序

## 本地预览

安装 Node.js 22 或更新版本，然后运行

```sh
npm run build
npm test
npm run dev
```

预览地址为 `http://127.0.0.1:5175/midianji/`

## 手机

用 Safari 打开发布后的 HTTPS 地址，添加到主屏幕，再从主屏幕打开并导入密码本

第一次从主屏幕打开时保持联网，等底部显示“可离线使用”后可断网使用

## 文件范围

发布内容只有 `dist` 中的程序、图标及离线缓存逻辑，不包含密码本或消息

不要把 `.itbook` 密码本、私人消息或登录凭据提交到此仓库

密码本保存在本机浏览器，请保留导出的文件备份
