/**
 * canteen-radar 单元测试 — 运行: npm test 或 node --test test/
 * 所有期望值均为手算，推导写在注释里。
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const radar = require("../src/recommend.js");

test("mean: 空数组返回 0，常规取均值", () => {
  assert.strictEqual(radar.mean([]), 0);
  assert.strictEqual(radar.mean([1, 2, 3]), 2);
});

test("bayesMean: 4 条四星、C=3.5、m=5 → (4×4 + 5×3.5)/9", () => {
  // R=4, v=4 → (16 + 17.5)/9 = 33.5/9 ≈ 3.722222
  assert.ok(Math.abs(radar.bayesMean([4, 4, 4, 4], 3.5, 5) - 33.5 / 9) < 1e-12);
});

test("bayesMean: 无评分时直接回落到先验均值", () => {
  assert.strictEqual(radar.bayesMean([], 3.5, 5), 3.5);
});

test("cosine: 同向=1、正交=0、零向量=0、反向=-1", () => {
  assert.ok(Math.abs(radar.cosine({ a: 1, b: 0 }, { a: 1, b: 0 }) - 1) < 1e-12);
  assert.strictEqual(radar.cosine({ a: 1, b: 0 }, { a: 0, b: 1 }), 0);
  assert.strictEqual(radar.cosine({ a: 0, b: 0 }, { a: 1, b: 1 }), 0);
  assert.ok(Math.abs(radar.cosine({ a: 2 }, { a: -3 }) + 1) < 1e-12);
});

test("buildTasteProfile: 好评加权、差评反向", () => {
  // (5-3)×{spicy:1} + (1-3)×{sweet:1} → {spicy:2, sweet:-2}
  const p = radar.buildTasteProfile([
    { flavors: { spicy: 1, sweet: 0 }, rating: 5 },
    { flavors: { spicy: 0, sweet: 1 }, rating: 1 }
  ]);
  assert.strictEqual(p.spicy, 2);
  assert.strictEqual(p.sweet, -2);
  // 无记录 → 空画像
  assert.deepStrictEqual(radar.buildTasteProfile([]), {});
});

test("freshness: 0 天→0，半衰期→0.5，两个半衰期→0.75，从未吃过→1", () => {
  assert.strictEqual(radar.freshness(0, 7), 0);
  assert.ok(Math.abs(radar.freshness(7, 7) - 0.5) < 1e-12);
  assert.ok(Math.abs(radar.freshness(14, 7) - 0.75) < 1e-12);
  assert.strictEqual(radar.freshness(null, 7), 1);
});

test("recentDrop: 高分段后连续低分触发预警", () => {
  // 全期均值=3，近 5 条均值=1 → drop=2 ≥ 0.8 → warning
  const r = radar.recentDrop([5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1]);
  assert.ok(Math.abs(r.drop - 2) < 1e-12);
  assert.strictEqual(r.warning, true);
});

test("recentDrop: 样本不足 8 条不预警", () => {
  const r = radar.recentDrop([5, 5, 1, 1]);
  assert.strictEqual(r.warning, false);
  assert.strictEqual(r.drop, 0);
});

test("pooledPriorMean: 跨菜品汇总所有评分取均值", () => {
  // [4,4] + [2] → 10/3
  const dishes = [{ ratings: [4, 4] }, { ratings: [2] }];
  assert.ok(Math.abs(radar.pooledPriorMean(dishes) - 10 / 3) < 1e-12);
});

test("recommend: 口味匹配决定同分菜品的先后", () => {
  const dishes = [
    { id: "s", name: "辣子鸡", canteen: "A", flavors: { spicy: 1 }, ratings: [4, 4, 4] },
    { id: "l", name: "蒸蛋", canteen: "A", flavors: { spicy: 0, light: 1 }, ratings: [4, 4, 4] }
  ];
  // quality、novelty 两项两菜相同，只差 taste：无辣 profile → 辣子鸡胜出
  const out = radar.recommend(dishes, { profile: { spicy: 1 }, topK: 2, maxPerCanteen: 5 });
  assert.strictEqual(out[0].dish.id, "s");
  assert.ok(out[0].score > out[1].score);
});

test("recommend: Top-K 内同一食堂最多 maxPerCanteen 个", () => {
  const mk = (id, canteen, r) => ({ id, name: id, canteen, flavors: {}, ratings: r });
  const dishes = [
    mk("a1", "A", [5, 5, 5, 5, 5]),
    mk("a2", "A", [5, 5, 5, 5, 5]),
    mk("a3", "A", [5, 5, 5, 5, 5]),
    mk("b1", "B", [4, 4, 4, 4, 4])
  ];
  const out = radar.recommend(dishes, { profile: {}, topK: 3, maxPerCanteen: 2 });
  assert.strictEqual(out.length, 3);
  const aCount = out.filter((x) => x.dish.canteen === "A").length;
  const bCount = out.filter((x) => x.dish.canteen === "B").length;
  assert.strictEqual(aCount, 2); // 第三个 A 被多样性约束挤出
  assert.strictEqual(bCount, 1); // B 虽分数低但递补进入
});

test("recommend: 近期口碑下滑的菜品带 warning 标记", () => {
  const dishes = [
    { id: "x", name: "滑坡窗口", canteen: "A", flavors: {}, ratings: [5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1] },
    { id: "y", name: "稳定窗口", canteen: "B", flavors: {}, ratings: [3, 3, 3, 3, 3, 3, 3, 3] }
  ];
  const out = radar.recommend(dishes, { profile: {} });
  const x = out.find((o) => o.dish.id === "x");
  assert.strictEqual(x.warning, true);
});

test("recommend: 刚吃过的菜品新鲜度=0，被同款分数的新菜压制", () => {
  const dishes = [
    { id: "old", name: "刚吃过", canteen: "A", flavors: {}, ratings: [4, 4, 4, 4] },
    { id: "new", name: "没吃过", canteen: "B", flavors: {}, ratings: [4, 4, 4, 4] }
  ];
  const out = radar.recommend(dishes, { profile: {}, eatLog: { old: 0 } });
  assert.strictEqual(out[0].dish.id, "new");
});
