# 面板前端

前端使用 Vue 3、TypeScript、Element Plus 和 Vite 多页面构建。界面按 Nyanpass 的布局与交互移植：64px 顶栏、200px 侧栏、400px 登录卡片、紧凑的表格与表单、浅色/深色/透明主题。页面标题使用站点设置中的名称。

这是接入 Nekopass 业务的 Vue 实现。Nyanpass 的 React 构建产物、第三方依赖包及 `/api`、WebSocket 客户端不随本项目发布。所有业务请求继续使用 Nekopass 的 `/api/v1` 与同源 Cookie。

## 页面与组件

| 文件 | 用途 |
| --- | --- |
| `src/AppHeader.vue` | 站点名、账号、退出登录、主题设置 |
| `src/ShellNavigation.vue` | 用户导航、管理员折叠菜单、当前页面高亮 |
| `src/PageShell.vue` | 登录后页面、加载与错误状态、手机抽屉导航 |
| `src/AuthShell.vue` | 登录与注册的公共页面结构 |
| `src/theme.ts` | 跟随系统、浅色/深色、透明模式与本地偏好 |
| `src/style.css` | 共享布局与 Element Plus 视觉样式 |
| `src/RulesPage.vue` | 用户与管理员共用的转发规则页面 |
| `src/ProbePage.vue` | NYP「节点状态（新）」表格/卡片、分组、备注与排序 |
| `src/ProbeProgress.vue`、`src/probe-new.css` | tz2 的进度条、紧凑布局与局部 BeerCSS 配色 |
| `src/probe-preferences.ts` | 按账号隔离的本地偏好、排序与持久化 |
| `src/views/NodeStatusView.vue` | 节点状态请求、前后台刷新调度与请求去重 |

默认主题跟随系统，兼容已有的 `nekopass-theme-v3` 浅色/深色偏好。透明模式单独保存。浏览器禁止本地存储时，当前页面仍可切换主题。小于 800px 时使用侧滑导航。

保留全部 24 个页面入口，包括管理员的节点协议、DDNS、自动换 IP 和用户规则页面。路由及权限由 `internal/control/pages.go` 提供，导航隐藏不能替代服务端权限检查。

首页保留公告轮播与全文读取；注册保留邮箱验证、验证码、邀请码与条款；规则保留协议、SNI、导入导出及批量操作。节点状态使用 `GET /api/v1/node-status` 的真实采样和就绪标记，每组内按唯一节点汇总实时流量，顶部服务器数量跨组去重。

## 节点状态（新）

`/node_status` 对照 NYP 的 `tz2` 页面移植，默认显示紧凑表格。设置菜单提供卡片/表格切换、深浅主题、详情视角、本地备注优先、组内排序和清空偏好。排序支持拖动、方向键及上下移按钮；修改先保留为草稿，点击「完成」保存，「放弃修改」恢复。

备注上限 200 字，和视图、组内顺序、刷新间隔一起按登录账号保存在当前浏览器。其他标签页变更会同步；清空仅影响当前账号的探针偏好。管理员详情视角只展开节点状态接口已返回的 JSON，不额外查询管理接口或提升权限。

刷新默认前台 2 秒、后台 10 秒，可设置为 1–300 秒；上一请求完成后才安排下一次，手动刷新与轮询共用正在执行的请求。指标按接口的 `*_ready` 标记显示；已就绪且被 Go JSON 省略的数字表示真实的 0，离线、维护、未就绪或无效数据保持未知。

现有接口提供 CPU、内存、磁盘、实时 Mbps、TCP/UDP 连接、负载和采样时间。原版的地区/出口 IP 列使用节点名称替代；操作系统、开机时长和累计网卡流量保留占位并显示「暂无数据」或「—」。没有推算这些数据，也没有接入 NYP 的 token、WebSocket、终端、权重或升级接口。完整显示这些遥测需要后端另行提供对应字段。

## 构建与运行

在仓库根目录执行：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

构建输出位于 `web/dist/`。按仓库根目录 README 的编译、安装流程与 Go 面板一起运行；前端没有附带演示账号或生产用的模拟接口。直接使用 Vite 静态预览不会提供 Cookie 登录、干净 URL 路由或业务 API。

服务端接口以 `api/openapi.yaml` 为准，新增界面功能应沿用 `src/api.ts` 与 `src/page.ts` 的会话、权限和错误处理。

## Vercel 前端演示

演示模式使用浏览器内的合成数据，默认以演示管理员身份浏览。页面标明演示状态；业务写操作不会提交，探针备注、排序等本地偏好仍可操作。此模式适合公开展示 UI，无需 Go 服务、数据库或真实节点。

在仓库根目录构建并部署：

```bash
npm --prefix web ci
npm --prefix web run build:demo
npx vercel login
npx vercel dist/vercel-demo
```

`dist/vercel-demo/` 包含静态文件和完整的 Vercel 页面重写配置，可以直接打开 `/node_status`。可将该目录部署到单独的演示项目。Vercel 支持时，也可尝试 `npx vercel dist/vercel-demo --temporary` 发布无需登录的临时演示；服务拒绝匿名部署时需要正常登录。

只有 `--mode demo` 构建会启用演示适配器。正常 `npm --prefix web run build` 输出到 `web/dist/`，仍使用真实 API，且不打包演示数据。不要将演示构建替换为生产面板资源。
