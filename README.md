# 🍚 Canteen Radar · 食堂雷达

> 校园食堂点评推荐工具 — 帮学生发现食堂新菜品、避开踩雷窗口。
> A zero-dependency recommendation engine for campus canteens: Bayesian rating shrinkage, taste-profile matching, novelty decay, and "quality-drop" alerting, with a single-file web UI.

![CI](https://github.com/TiannaZhang925/canteen-radar/actions/workflows/ci.yml/badge.svg)
![tests](https://img.shields.io/badge/tests-13%20passed-3ecf8e)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

## 30 秒上手 / Quick Start

```bash
git clone https://github.com/TiannaZhang925/canteen-radar.git
cd canteen-radar
npm test                              # 13 项单测，Node 内置 runner，无需 npm install
open index.html                       # 或双击直接用浏览器打开，即是完整可用的 App
```

## 解决什么问题 / The Problem

大学生每天要回答"今天食堂吃什么"，但菜品评价分散在口口相传里：新窗口没人试、老窗口吃腻了、某个窗口最近换厨师变难吃了也没人知道。Canteen Radar 用一个轻量推荐算法把这四类信号合并成一个排序分：

| 信号 | 算法 | 作用 |
|---|---|---|
| 口碑质量 | 贝叶斯平均分收缩 `score = (v·R + m·C)/(v + m)` | 防止 2 条五星刷掉 16 条四星的老店 |
| 口味匹配 | 用户点评构造口味向量，与菜品风味向量做余弦相似 | 你爱辣就多看川湘窗口 |
| 新鲜度 | 指数回升 `1 − 2^(−days/halfLife)` | 吃腻的菜自动沉底，半衰期 7 天 |
| 踩雷预警 | 近 5 条均值 − 历史均值 ≥ 0.8★ 时标记 | "水煮肉片窗口近期滑坡"直接挂红牌 |

Top-K 输出附加**多样性约束**：同一食堂最多进 2 道菜，强制带你换食堂尝新。

## 架构 / Layout

```
index.html              单文件前端（无框架），localStorage 存点评与就餐记录
src/recommend.js        纯函数推荐核心 · UMD（浏览器 window.CanteenRadar / Node require 双入口）
test/recommend.test.js  13 项 node:test 单测，全部手算期望值断言
.github/workflows/ci.yml CI 门禁：npm test
```

算法核心不含任何 DOM/存储依赖，可单独作为库复用或继续评估（如换 embedding 特征、上线 AB 权重）。

## 测试覆盖 / Tests

`npm test` 实际验证（本机 Node v22 全绿，CI 同配置）：

- 贝叶斯收缩的手算值 `(4×4 + 5×3.5)/9 = 3.722`、空样本回落先验
- 余弦相似：同向/正交/反向/零向量四例
- 口味画像：好评加权 + 差评反向（`{spicy:2, sweet:-2}`）
- 新鲜度：0 天→0、7 天→0.5、14 天→0.75、从未吃过→1
- 滑坡检测：`[5×6, 1×6]` 触发 warning、样本 <8 不触发
- 端到端排序：口味决胜、同食堂 ≤2 的多样性递补、刚吃过被压制

## 使用流程 / How to Use

1. 「今日推荐」看 Top-6（3 食堂 × 每食堂 ≤2 道），卡片上有质量/口味/新鲜三维分解条与预警徽章
2. 吃完某道菜 → 点「我刚吃过」（影响新鲜度）或「✍ 点评」打星+一句话（进入你的口味画像）
3. 「全部菜品」可按口碑/价格切换、一键排除预警窗口
4. 「我的档案」查看各风味维度偏好强度，可随时清空数据

所有数据只存本地浏览器，不上传任何服务器。

## License

MIT © 2026 Tianna Zhang
