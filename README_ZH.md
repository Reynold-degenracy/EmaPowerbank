[English](README.md) | [简体中文](README_ZH.md)

# Ema Powerbank

Ema Powerbank 是一个 Gemini API token 中转站，使用 TypeScript、React、Express 和 SQLite 构建。它对外暴露 Gemini REST 形状的 `/api/v1*` 端点，不做 OpenAI 兼容协议转换，核心职责是替换上游认证、转发请求、记录审计日志、统计用量并按余额计费。

## 特性

- 单端口服务：前端页面和后端 API 默认共用 `http://localhost:8787`，后端接口统一以 `/api` 开头。
- 透传 Gemini REST：用户请求路径保持 Gemini API 形状，只需要把 Base URL 改成本站的 `/api` 地址。
- 用户系统：用户名和密码注册/登录，无额外认证流程。
- API key 管理：用户可创建、复制、删除自己的 `ep_` 前缀 API key。
- 管理控制台：唯一管理员可配置上游、维护模型价格、调整余额、删除用户。
- 上游支持：Google AI Studio API Key 和 Vertex AI 服务账号 JSON。
- 计费统计：按日期展示费用统计，支持模型多选筛选、成功请求/总请求数、token 分项和费用分项。
- 全局统计：累计费用、今日花费、请求数、请求成功率、累计 Token 数、缓存命中率。
- SQLite 持久化：用户、密钥、上游配置、模型价格、用量记录都存储在 `data/relay.sqlite`。
- 审计文件：每个透传请求都会在 `request-logs/` 保存一份 JSON，文件名包含时间戳和用户 id。

## 技术栈

- React 19
- TypeScript
- Vite 7
- Express 5
- better-sqlite3
- Google GenAI SDK
- google-auth-library

建议使用 Node.js 20 或更新版本。

## 快速开始

```bash
npm install
npm run dev
```

开发服务默认启动在：

```text
http://localhost:8787
```

首次启动时，如果数据库里还没有管理员账号，会自动创建：

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123456
```

登录后进入管理控制台，先完成上游配置，再给用户设置余额，用户即可通过自己的 API key 访问 Gemini API。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | Web 服务端口 |
| `NODE_ENV` | `development` | 设为 `production` 后使用 `dist/` 静态资源 |
| `JWT_SECRET` | `development-only-change-me` | 登录 session 签名密钥，生产环境必须设置 |
| `SESSION_COOKIE_SECURE` | 未设置时按 `NODE_ENV` 推导：生产环境为 `true`，否则为 `false` | 覆盖登录 session cookie 是否使用 `Secure` 属性 |
| `ADMIN_USERNAME` | `admin` | 首次初始化管理员用户名 |
| `ADMIN_PASSWORD` | `admin123456` | 首次初始化管理员密码 |

生产环境示例：

```bash
export JWT_SECRET="replace-with-a-long-random-secret"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="replace-with-a-strong-password"
export PORT=8787
# 只有生产环境使用纯 HTTP 访问时才需要设置这个值。
export SESSION_COOKIE_SECURE=false

npm ci
npm run build
# 构建产物已存在的运行镜像里，可以选择裁剪 devDependencies。
npm prune --omit=dev
npm start
```

`SESSION_COOKIE_SECURE` 的优先级高于 `NODE_ENV` 推导出的默认值。如果通过 HTTPS 访问，请保持 `true`。只有纯 HTTP 部署才设置为 `false`，否则浏览器会拒收生产环境的 session cookie，登录后就会出现 `Not authenticated`。

## 管理员配置

管理员登录后需要先配置一个上游。

AI Studio：

- 选择 `AI Studio`
- 填写字符串形式的 `API Key`
- 不需要填写 location

Vertex AI：

- 选择 `Vertex AI`
- 填写 `Location`，默认可用 `global`
- 填写服务账号 JSON
- 服务账号 JSON 必须包含 `project_id`
- 服务账号需要具备调用 Vertex AI Gemini 模型的权限

当前生效的上游会在管理面板显示。AI Studio 和 Vertex AI 的凭证会存储在 SQLite 的 `settings` 表中，请确保部署目录和数据库文件权限可靠。

## 默认模型价格

首次启动会写入默认计费模型：

| 模型 | 未缓存输入 | 输出 | 缓存输入 | 嵌入 |
| --- | ---: | ---: | ---: | ---: |
| `gemini-3.5-flash` | `$1.50/M` | `$9.00/M` | `$0.15/M` | `-` |
| `gemini-3.1-pro-preview` | `$2.00/M` | `$12.00/M` | `$0.20/M` | `-` |
| `gemini-embedding-001` | `-` | `-` | `-` | `$0.15/M` |
| `gemini-embedding-2` | `-` | `-` | `-` | `$0.20/M` |

管理员可以在模型计费表里删除并重新新增模型价格。同一个模型 ID 不允许重复新增。价格为 `0` 或空的项目会被视为不可用，前端显示为 `-`。

## 计费规则

价格单位为每 1M tokens 或 characters。

- 未缓存输入：`promptTokenCount - cachedContentTokenCount`
- 输出：`thoughtsTokenCount + candidatesTokenCount`
- 缓存输入：`cachedContentTokenCount`
- 嵌入：`billableCharacterCount`

只有上游返回 `2xx` 时才会扣费。没有配置价格或价格为 `0` 的模型不会扣费，但请求仍会记录审计日志和用量记录。

Embedding 模型会统一把用量归到“嵌入”字段。对于没有 `billableCharacterCount` 的返回，服务会用返回里的 token 统计回填到嵌入用量，避免把 embedding 用量记到输入或输出里。

## 用户接入

用户登录面板后可以：

- 查看余额、累计费用、今日花费、请求成功率
- 创建和复制 API key
- 复制 Base URL
- 查看可用模型和对应价格
- 用内置 API 测试面板发送测试请求
- 提交问题反馈，包含必填问题描述和最多 10 张可选图片附件；问题反馈被采纳后可获得奖励金额
- 查看按日期的费用统计

Base URL 填写：

```text
http://localhost:8787/api
```

生产部署时请替换为你的域名，例如：

```text
https://example.com/api
```

请求认证支持以下方式：

- `x-goog-api-key: ep_xxx`
- `x-api-key: ep_xxx`
- `Authorization: Bearer ep_xxx`
- URL query：`?key=ep_xxx`

推荐使用 header，避免 key 出现在访问日志或浏览器历史里。

## 调用示例

生成内容：

```bash
curl "http://localhost:8787/api/v1beta/models/gemini-3.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ep_xxx" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "Who are you?" }
        ]
      }
    ]
  }'
```

Embedding：

```bash
curl "http://localhost:8787/api/v1beta/models/gemini-embedding-001:batchEmbedContents" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ep_xxx" \
  -d '{
    "requests": [
      {
        "model": "gemini-embedding-001",
        "content": {
          "role": "user",
          "parts": [
            { "text": "hello" }
          ]
        }
      }
    ]
  }'
```

AI Studio 上游会直接转发到 `generativelanguage.googleapis.com`。Vertex AI 上游会将 `/api/v1beta/models/{model}:...` 自动映射到当前服务账号的 `project_id`、配置的 `location` 和 Vertex publisher model 路径。

对于 Vertex AI embedding 请求，`gemini-embedding-001` 和 text embedding 模型会自动转换为 Vertex 的 `predict` 形状；较新的 Gemini embedding 模型会转换为 Vertex 的 `embedContent` 形状。响应会转换回批量 embedding 形状。

## 数据目录

运行后会生成两个目录：

```text
data/relay.sqlite
request-logs/
feedback/
```

`data/relay.sqlite` 保存：

- 用户和管理员账号
- 用户 API key 哈希和新 key 的可复制值
- 上游配置
- 模型价格
- 用户余额
- 用量记录

`request-logs/` 保存每个透传请求的 JSON 审计文件，包含：

- 请求路径、方法、headers、请求体
- 上游 URL，敏感 query 会被脱敏
- 响应状态和响应体
- 提取后的用量和费用
- 请求总耗时和分段耗时

`feedback/` 保存每次提交后的反馈包目录。每个目录命名为 `feedback-<id>-<timestamp>/`，包含 `feedback.json` 和最多 10 张可选上传图片，每张图片最大 5 MB。JSON 文件会记录反馈 id、时间戳、提交用户、问题描述、附件元数据数组、审核状态和奖励元数据。管理员可以按待审核、已通过、已拒绝筛选反馈；每个状态列表按每页 10 条分页。管理员可以导出全部反馈 CSV，字段为 `user-name`、`user-id`、`description`、`attachments-filenames`、`review-status`。管理员可以审核反馈，在带标签的只读文本框中查看问题描述，在问题描述下方查看提交时间和反馈包名，横向预览图片附件，通过并发放非零奖励金额，或拒绝且不发放余额。

## 日志页

登录用户可以打开 `日志` 页面查看自己的请求日志。管理员可以查看全部用户日志，并使用用户筛选。后端会同时限制列表和详情接口，因此普通用户无法通过猜测日志 id 访问别人的日志。日志列表从 SQLite 的 `usage_records` 表中读取索引信息，因此按用户/时间筛选和每页 20 条的分页不会扫描或加载所有 JSON 审计文件。列表中展示的用户、请求时间、模型、状态码、用量、费用、总耗时和审计文件名都来自数据库记录。

有权限的用户展开某一条日志时，后端会根据该数据库记录里的 `audit_file` 到 `request-logs/` 读取对应 JSON 文件，并把完整请求/响应详情返回给前端展示。如果数据库记录仍然存在，但对应 JSON 文件已经被删除，列表中仍会显示这一条；展开时接口会返回 `404 Request log file not found`，前端会在该日志行内显示这个错误。

注意：请求体和响应体会原样保存，可能包含用户敏感数据。生产环境请限制目录权限，并制定清理、归档和备份策略。

## 生产部署

构建前端和后端：

```bash
npm run build
```

启动生产服务：

```bash
NODE_ENV=production npm start
```

`npm run build` 会把 Vite 前端输出到 `dist/`，并把 Express 后端编译到 `dist-server/`。`npm start` 运行的是 `node dist-server/index.js`，因此只要构建产物已经存在，生产运行环境可以省略 devDependencies。

生产模式下 Express 会服务 `dist/` 静态文件，并继续在同一端口提供 `/api` 后端接口和 Gemini 透传接口。

建议：

- 使用 HTTPS
- 设置强 `JWT_SECRET`
- 修改默认管理员密码
- 限制 `data/` 和 `request-logs/` 的文件权限
- 限制 `feedback/` 的文件权限
- 定期备份 `data/relay.sqlite`
- 按需清理或归档 `request-logs/`
- 按需清理或归档 `feedback/`
- 如果放在反向代理后面，请确保请求体大小和超时设置适合模型响应

## 验证

类型检查：

```bash
npm run typecheck
```

构建检查：

```bash
npm run build
```

构建后的后端 smoke test：

```bash
npm run smoke
```

健康检查：

```bash
curl http://localhost:8787/api/health
```

返回示例：

```json
{
  "ok": true,
  "time": "2026-06-01T17:44:56.974Z"
}
```

## 设计边界

Ema Powerbank 只做 Gemini REST 透传和本地管理能力：

- 不转换 OpenAI Chat Completions 或 Responses API
- 不修改用户请求的底层语义
- 不隐藏上游错误
- 不实现多上游负载均衡

如果需要兼容 OpenAI 协议，应在客户端或另一个网关层完成协议转换。
