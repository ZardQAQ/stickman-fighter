# 火柴人格斗

**原作者：** [Youssef Serestou](https://github.com/sinusphi) — [sinusphi/stickman-fighter](https://github.com/sinusphi/stickman-fighter)。本仓库是该项目的修改副本。著作权仍归原作者所有，详见 [LICENSE](LICENSE)。

![Gameplay-Demo](https://github.com/sinusphi/stickman-fighter/blob/main/pics/demo.gif)

[![Version](https://img.shields.io/badge/version-1.4.0-2563eb)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://github.com/sinusphi/stickman-fighter/blob/main/LICENSE)

**中文** · [Deutsch](README.de.md)

[▶ 立即游玩](http://p2pstick.zard.loc.cc/)

这是一款用 TypeScript 和 Canvas 2D 制作的本地双人火柴人格斗游戏。它把 60 Hz 的确定性对战，与键盘和手柄操作、电脑对手、训练工具、录像回放以及多个场地结合在一起。


## 功能

- 本地对战、对战电脑、电脑对电脑
- 33 种站立、下蹲、空中、旋转、龙卷风和连招攻击
- 格挡、跳跃、三局两胜，以及战斗计量条
- 训练模式、判定框显示、逐帧步进和动画预览
- 确定性录像的录制、导入和导出
- 可重新设置的键盘和手柄按键
- 中文、英文和德文界面，浅色和深色主题，以及三个场地


## 环境要求

- Node.js 22.12+（22.x）、24.x 或 26+
- npm


## 开始使用

```sh
npm ci
npm run dev
```

打开终端里显示的地址，通常是 <http://127.0.0.1:1025>。


## 默认操作

| 操作 | 玩家 1 | 玩家 2 | 手柄 |
|---|---|---|---|
| 移动 | W / A / S / D | 方向键 | 十字键 / 左摇杆 |
| 轻拳 / 中拳 / 重拳 | R / T / Y | 小键盘 7 / 8 / 9 | X / Y / RB |
| 左侧低踢 / 中踢 / 高踢 | F / G / H | 小键盘 4 / 5 / 6 | A / 未分配 / RT |
| 右侧低踢 / 中踢 / 高踢 | V / B / N | 小键盘 1 / 2 / 3 | 未分配 / B / 未分配 |
| 暂停 | P | P | — |

方向相对于对手：**6** 向前，**4** 向后，**2** 下蹲，**7/8/9** 跳跃。
按 **Backspace** 重新开始一局。按键可以在游戏内重新设置。


## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并生成生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run check` | 类型检查、校验生成数据并构建 |


## 项目结构

- `src/simulation/` — 确定性的战斗与对局逻辑
- `src/render/` — Canvas 绘制与动画
- `src/data/` — 招式、姿势、规则和配置
- `scripts/` — 数据生成脚本


## 许可证

本项目采用 **MIT 许可证**。
Copyright (c) 2026 Youssef Serestou.
详见 [LICENSE](LICENSE)。


## 贡献

欢迎贡献。

* [拉取请求](https://github.com/sinusphi/stickman-fighter/pulls)

* [缺陷报告](https://github.com/sinusphi/stickman-fighter/issues)

* [功能建议](https://github.com/sinusphi/stickman-fighter/issues)
