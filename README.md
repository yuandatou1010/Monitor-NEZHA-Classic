# NEZHA Classic for CF-Server-Monitor

这是一个针对 `CF-Server-Monitor` 的第三方主题，视觉目标为 **NEZHA V0 Classic** 风格。

## 显示内容
```text
左上角 绿色代表WSS已连接 黄色代表连接中 红色代表已断开
右上角 四叶草图标点击进入管理页面。
```
- 每台服务器只显示：

- 国家/地区旗帜
- 系统图标
- 服务器名称
- CPU
- 内存
- Swap
- 硬盘
- 网速
- 总流量
- CPU 核心 / 内存 / 磁盘容量
- 服务器负载
- 在线时间
- 右上角信息按钮

不使用 CF-Server-Monitor 原本的 Dashboard、地图、统计图、价格、到期时间等前台模块。

## 数据接口

主题使用 CF-Server-Monitor 当前公开 API：

- `GET /api/config`
- `GET /api/servers`
- `GET /api/ws`

`/api/servers` 首次提供完整服务器数据；WebSocket 使用 `batchUpdate` 增量更新 CPU、内存、Swap、网速等实时数据。

## 部署

把：

```text
index.html
assets/app.css
assets/app.js
```

放进一个公开 GitHub 仓库。

然后在 CF-Server-Monitor 管理后台的第三方主题中填写：

```text
https://github.com/你的用户名/你的主题仓库/tree/main
```

建议使用固定 commit 地址，以避免主题被意外修改。

## 常用修改
```text
<style>
:root {
  --outer-max-width: 1888px !important;  //外框宽度
  --cards-per-row: 6;      //每排卡片数量
  --card-width: 278px;     // 卡片宽度
  --card-height: 333px;    // 卡片高度
</style>
```
## 注意

第一版假定 CF-Server-Monitor 前台和主题使用同域部署。

如果你的站点启用了 Turnstile，主题需要继续接入项目现有的 Turnstile 验证流程；如果站点是公开站点且没有 Turnstile，则可以直接工作。

## 当前版本

v0.8.0
