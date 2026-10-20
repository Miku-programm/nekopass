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
| `src/ProbePage.vue` | 节点卡片/列表、筛选排序与指标显示 |
| `src/views/NodeStatusView.vue` | 节点状态请求、5 秒刷新与手动刷新去重 |

默认主题跟随系统，兼容已有的 `nekopass-theme-v3` 浅色/深色偏好。透明模式单独保存。浏览器禁止本地存储时，当前页面仍可切换主题。小于 800px 时使用侧滑导航。

保留全部 24 个页面入口，包括管理员的节点协议、DDNS、自动换 IP 和用户规则页面。路由及权限由 `internal/control/pages.go` 提供，导航隐藏不能替代服务端权限检查。

首页保留公告轮播与全文读取；注册保留邮箱验证、验证码、邀请码与条款；规则保留协议、SNI、导入导出及批量操作。节点状态使用 `GET /api/v1/node-status` 的真实采样和就绪标记，按唯一节点汇总流量；同一节点在多个组中展示时不会重复累计。

## 构建与运行

在仓库根目录执行：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

构建输出位于 `web/dist/`。按仓库根目录 README 的编译、安装流程与 Go 面板一起运行；前端没有附带演示账号或生产用的模拟接口。直接使用 Vite 静态预览不会提供 Cookie 登录、干净 URL 路由或业务 API。

服务端接口以 `api/openapi.yaml` 为准，新增界面功能应沿用 `src/api.ts` 与 `src/page.ts` 的会话、权限和错误处理。
