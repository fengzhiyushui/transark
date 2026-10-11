# 参与贡献指南 (Contributing Guide)

感谢你关注并有意向为「译舟 (TransArk)」项目贡献代码！为了维护高质量、高安全性的开源生态，请在提交代码前仔细阅读本指南。

---

## 1. 行为准则
本项目遵循 [Contributor Covenant](./CODE_OF_CONDUCT.md) 行为准则，请确保在社区交流中保持友好、包容和尊重。

---

## 2. 参与流程

1. **Fork 本仓库** 到你个人的 GitHub 账号下。
2. **创建特性分支**：
   ```bash
   git checkout -b feature/your-feature-name
   # 或修复 bug 分支
   git checkout -b fix/issue-description
   ```
3. **本地开发与测试**：
   - 遵循现有的 Monorepo 规范，严禁绕过共享契约包 `@translate/contracts`。
   - 所有新增功能必须补充单元测试。
4. **提交前自检**：
   ```bash
   # 1. 确保代码格式与类型检查 0 报错
   pnpm typecheck

   # 2. 确保全量自动化测试全部通过
   pnpm test
   ```
5. **提交 Commit 信息**（推荐遵循 Conventional Commits 规范）：
   - `feat: 添加 PDF 扫描件 OCR 增强模式`
   - `fix: 修复某些站点虚拟列表切换时的 DOM 挂载异常`
   - `docs: 更新本地伴随服务配对说明`
6. **创建 Pull Request**：详细描述变更动机与测试证据。

---

## 3. 代码与架构规范

- **零外部 CDN 脚本**：扩展端严禁引入任何外链远程脚本，所有第三方库必须通过 npm 依赖并在本地打包。
- **Contract-First 契约先行**：若涉及接口、事件、错误码、数据模型变更，必须优先修改 `packages/contracts`，并通过测试后再更新扩展或后端。
- **隐私保护底线**：严禁引入任何无用户授权的遥测、用户输入搜集或隐式外网回退逻辑。
- **相对路径与无敏感信息**：代码、注释、文档中严禁写入绝对开发路径、开发者个人用户名或硬编码秘钥。
