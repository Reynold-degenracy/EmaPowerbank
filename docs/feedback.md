# 反馈功能说明

## 功能入口

登录后，侧边栏会显示与“面板”“日志”同级的“反馈”入口。普通用户和管理员都可以提交反馈。

反馈表单包含：

- 必填文字描述
- 可选图片附件

## 提交接口

前端通过 `POST /api/feedback` 提交反馈。接口要求用户已登录，并使用 `multipart/form-data`。

表单字段：

- `description`：必填，反馈文字描述，提交前后端都会去除首尾空白，最大 5000 字符
- `attachment`：可选，图片附件

附件支持常见图片格式：

- PNG
- JPEG / JPG
- GIF
- WebP
- BMP
- AVIF
- HEIC / HEIF

单个附件最大 8 MB。前端会先做格式和大小校验，后端仍会再次校验。

## 保存位置

后端会在项目运行目录下创建 `feedback/`，每次提交保存为一个独立目录：

```text
feedback/feedback-<id>-<timestamp>/
```

示例：

```text
feedback/feedback-fb_3d75a673-5aaf-4c60-9342-472feac83378-2026-06-09T13-38-03-368Z/
```

其中：

- `feedback-` 是固定前缀
- `fb_3d75a673-5aaf-4c60-9342-472feac83378` 是反馈 id，从 `fb_` 开始
- `2026-06-09T13-38-03-368Z` 是提交时间戳

目录名中的时间戳会把 ISO 时间里的 `:` 和 `.` 替换成 `-`，方便作为文件系统路径使用。原始时间戳仍保存在 `feedback.json` 的 `timestamp` 字段里。

## 反馈包内容

每个反馈目录固定包含：

```text
feedback.json
```

如果用户上传了图片，还会包含一个图片文件，文件名同样包含反馈 id 和时间戳：

```text
feedback-fb_<uuid>-<timestamp>.<ext>
```

`feedback.json` 包含：

- `id`：反馈 id
- `timestamp`：原始 ISO 提交时间
- `user`：提交用户的 id、用户名和角色
- `description`：反馈文字描述
- `attachment`：附件元数据；没有附件时为 `null`

附件元数据包含：

- `fileName`：后端保存后的附件文件名
- `originalName`：用户上传时的原始文件名
- `mimeType`：附件 MIME 类型
- `size`：附件字节数

## 运行与维护

`feedback/` 是运行时数据目录，已经加入 `.gitignore`，不会进入版本库。

生产环境建议：

- 限制 `feedback/` 的文件权限
- 按需清理、归档或备份反馈包
- 不要把包含用户反馈或附件的目录提交到代码仓库

## 本地测试文件

本次开发中用于验证红灯阶段的临时脚本已按路径加入 `.gitignore`：

- `server/feedback.test.ts`
- `src/api.test.ts`

这些文件仍可在本地用于回归验证，但不会作为待提交文件出现。
