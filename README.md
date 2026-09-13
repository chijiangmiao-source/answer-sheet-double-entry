# 纸质答题卡双录核对台

纯前端的“双录入核对”工具：同一张固定 20 道单选题的纸质答题卡，由录入员连续录入两遍。系统只在两遍都完整提交后逐题比对——**全部一致才“通过”，否则“不通过”并仅列出差异题**，以此避免复核时惯性照抄第一遍答案导致错误漏检。

- 技术栈：TypeScript + Vue 3（Composition API）+ Vite
- 无后端、无假接口、无固定响应：题面数据在构建时固定，两轮答案只存在于浏览器内存，刷新即清空
- 单元/组件测试：Vitest（20 个用例）
- 端到端测试：Playwright（3 个用例，覆盖通过、不通过、重新开始）

## 业务规则

1. 固定 20 道单选题，每题只接受 **A / B / C / D**（大小写均可），其他按键一律忽略。
2. 键盘：
   - `A` `B` `C` `D`：为当前题选择选项，并自动前进到下一题（末题停留在原位）；
   - `↑` `↓` `←` `→`：在题目间前后移动（边界处不越界）；
   - 也可用鼠标直接点选任意题、任意选项。
3. 任一轮存在漏题时**不能提交**：顶部汇总漏答题号，并在每一道漏答题的原位置标注“此题漏答”。
4. 首录完整提交后：
   - 生成**不可修改的内存快照**（对象冻结，且提交时复制，与录入数组隔离）；
   - 界面立即清空并进入第二轮；第二轮的页面内容、焦点（默认第 1 题）与输入状态都不透露、不预填首录选择。
5. 第二轮完整提交后逐题裁决：
   - 两轮完全一致：显示 **“通过”** 与 **20/20**；
   - 只要有差异：显示 **“不通过”** 与一致数（如 19/20），并**只列出差异题号及两轮选项**，不展示一致题。
6. 结果页点击“重新开始”：清除两轮状态（含首录快照与裁决结果），返回空白的第一轮。

## 轮次隔离是如何保证的

- 首录快照保存在 `createSession()`（`src/composables/useSession.ts`）闭包局部变量中，对外 API 只有 `phase / round / verdict / submit / restart`，第二轮组件无法读取首录答案。
- 第二轮录入视图以轮次为 `key` 整体重新挂载（`src/App.vue`），答题数组、当前焦点、提交状态全部重新初始化为空。
- 裁决完成后闭包立即释放首录引用；结果对象中只保留差异信息。

## 本地开发

```bash
npm ci
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 本地预览生产构建
```

## 测试

```bash
npm run test:unit  # Vitest：轮次隔离、完整性校验、裁决规则、键盘与原位提示
npm run test:e2e   # Playwright：通过 / 不通过 / 重新开始（自动起 preview 服务）
```

Vitest 覆盖：

- 空卡与冻结快照、漏题拒绝提交、快照与原数组隔离；
- 一致裁决（通过、20/20）、单题/多题差异（仅列差异、题号升序）、拒绝裁决不完整卡；
- 会话状态机：两轮状态推进、API 不暴露首录答案、第二轮漏题拦截、重启清空；
- 组件：非法按键忽略、键盘选择与移动、漏题原位提示、补齐后提交、第二轮无预填。

Playwright 覆盖：

1. 两轮 20 题一致 → “通过” + 20/20，且第二轮初始为空白、焦点在第 1 题；
2. 第二轮第 3 题不同 → “不通过” + 19/20，差异表只有第 3 题一行（首录 A / 第二遍 B）；
3. 首录漏第 20 题被拦截并原位提示，补齐走完两轮后“重新开始”，确认回到无任何选择与结果的空白首录。

## Docker Compose

提供两个服务（`docker-compose.yml`）：

### 静态 Web

```bash
docker compose up -d --build web
# 默认 http://localhost:8080
```

宿主端口可用 `WEB_PORT` 覆盖：

```bash
WEB_PORT=9000 docker compose up -d web
# http://localhost:9000
```

Web 镜像（`Dockerfile`）多阶段构建：Node 构建静态资源，nginx:alpine 托管 `dist/`，SPA 路径回退到 `index.html`。

### 一次性验收服务 verify

```bash
docker compose build verify
docker compose run --rm verify
```

容器内串行执行 **Vitest 单测 → Playwright 端到端测试**，全部通过退出码为 0，任一失败为非零；进程结束即退出（`restart: "no"`），不会常驻。基于官方 Playwright 镜像（`mcr.microsoft.com/playwright:v1.49.1-jammy`），浏览器与系统依赖均已预装。

## 目录结构

```
src/
  data/questions.ts        # 固定 20 道单选题（仅题面，无答案）
  core/types.ts            # 领域类型
  core/scoring.ts          # 纯函数：空卡、提交快照、逐题裁决
  composables/useSession.ts# 两轮状态机与首录快照隔离
  components/RoundView.vue # 单轮录入（键盘/鼠标、漏题原位提示）
  components/ResultView.vue# 裁决结果与差异明细
tests/unit/                # Vitest
tests/e2e/                 # Playwright
Dockerfile / Dockerfile.verify / nginx.conf / docker-compose.yml
```
