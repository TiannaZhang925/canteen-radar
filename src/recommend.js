/**
 * canteen-radar — 校园食堂菜品点评推荐核心算法（纯函数、零依赖）
 *
 * 同一份代码有两个入口：
 *   - 浏览器: <script src="src/recommend.js"> → window.CanteenRadar
 *   - Node:   const radar = require("./src/recommend.js")   （用于 node --test）
 *
 * 排序分 = w_quality·贝叶斯评分 + w_taste·口味匹配 + w_novelty·新鲜度
 *   1. 贝叶斯评分（评分收缩）：小样本菜品不被几条五星刷上榜首
 *   2. 口味匹配：用用户自己的点评构造口味向量，与菜品风味向量做余弦相似
 *   3. 新鲜度：按"距今几天没吃"做指数回升，避免天天推同一扇门
 *   4. 踩雷预警：近 N 条评分显著低于历史均值 → 标记"近期口碑下滑"
 *   5. 多样性约束：Top-K 内同一食堂最多 maxPerCanteen 家，强制换食堂尝新
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CanteenRadar = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    priorWeight: 5, // 贝叶斯先验强度（等效于额外 m 条先验评分）
    halfLifeDays: 7, // 新鲜度半衰期：7 天没吃即可回升到 0.5
    tasteDropThreshold: 0.8, // 近期均值比历史均值低多少算踩雷预警
    tasteDropWindow: 5, // "近期"取最后几条评分
    minRatingsForDrop: 8, // 样本太少不触发预警
    topK: 8,
    maxPerCanteen: 2,
    weights: { quality: 0.5, taste: 0.3, novelty: 0.2 }
  };

  /** 一组评分的均值；空数组返回 0 */
  function mean(ratings) {
    if (!ratings || ratings.length === 0) return 0;
    var s = 0;
    for (var i = 0; i < ratings.length; i++) s += ratings[i];
    return s / ratings.length;
  }

  /**
   * 贝叶斯平均分（评分收缩）：score = (v·R + m·C) / (v + m)
   * R=该菜品均分, v=条数, C=全局先验均值, m=priorWeight
   */
  function bayesMean(ratings, priorMean, priorWeight) {
    if (typeof priorWeight !== "number") priorWeight = DEFAULTS.priorWeight;
    var v = ratings ? ratings.length : 0;
    if (v === 0) return priorMean;
    return (v * mean(ratings) + priorWeight * priorMean) / (v + priorWeight);
  }

  /**
   * 由用户点评记录构造口味向量。
   * records: [{ flavors: {spicy: 0.8, ...}, rating: 1..5 }]
   * 每维 = Σ (rating-3)·flavor[dim]，即好评加权、差评反向修正。
   */
  function buildTasteProfile(records) {
    var profile = {};
    if (!records || records.length === 0) return profile;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var w = r.rating - 3;
      var f = r.flavors || {};
      for (var k in f) {
        if (Object.prototype.hasOwnProperty.call(f, k)) {
          profile[k] = (profile[k] || 0) + w * f[k];
        }
      }
    }
    return profile;
  }

  /** 两个稀疏向量（普通对象）的余弦相似度，零向量返回 0 */
  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) {
      if (Object.prototype.hasOwnProperty.call(a, k)) na += a[k] * a[k];
    }
    for (k in b) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        nb += b[k] * b[k];
        if (a[k]) dot += a[k] * b[k];
      }
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * 新鲜度 ∈ [0,1]：1 - 2^(-days/halfLife)。
   * 刚吃过(days=0)→0；一个半衰期→0.5；从未吃过(null/undefined)→1。
   */
  function freshness(daysSinceLast, halfLifeDays) {
    if (daysSinceLast === null || daysSinceLast === undefined) return 1;
    if (typeof halfLifeDays !== "number") halfLifeDays = DEFAULTS.halfLifeDays;
    if (daysSinceLast <= 0) return 0;
    return 1 - Math.pow(2, -daysSinceLast / halfLifeDays);
  }

  /**
   * 近期口碑下滑检测（评分按时间升序）。返回 {drop, warning}
   * drop = 历史均值 - 近 N 条均值，越大说明最近越拉胯。
   */
  function recentDrop(ratings, window, minRatings, threshold) {
    window = window || DEFAULTS.tasteDropWindow;
    minRatings = minRatings || DEFAULTS.minRatingsForDrop;
    threshold = typeof threshold === "number" ? threshold : DEFAULTS.tasteDropThreshold;
    if (!ratings || ratings.length < minRatings) {
      return { drop: 0, warning: false };
    }
    var recent = ratings.slice(-window);
    var drop = mean(ratings) - mean(recent);
    return { drop: drop, warning: drop >= threshold };
  }

  /** 全局先验均值 C：所有菜品所有评分的均值 */
  function pooledPriorMean(dishes) {
    var all = [];
    for (var i = 0; i < dishes.length; i++) {
      all = all.concat(dishes[i].ratings || []);
    }
    return mean(all);
  }

  /**
   * 给单个菜品打分，返回 {score, detail:{quality,taste,novelty}, warning}
   * opts: { profile, daysSinceLast, priorMean, weights, halfLifeDays, ... }
   */
  function scoreDish(dish, opts) {
    var w = opts.weights || DEFAULTS.weights;
    var quality = bayesMean(dish.ratings, opts.priorMean, opts.priorWeight);
    // 归一：评分 ∈ [1,5] → [0,1]，下限取 0
    var qualityNorm = Math.max(0, (quality - 1) / 4);
    var taste = cosine(opts.profile || {}, dish.flavors || {});
    var novel = freshness(opts.daysSinceLast, opts.halfLifeDays);
    var drop = recentDrop(
      dish.ratings,
      opts.tasteDropWindow,
      opts.minRatingsForDrop,
      opts.tasteDropThreshold
    );
    return {
      score: w.quality * qualityNorm + w.taste * taste + w.novelty * novel,
      detail: {
        quality: qualityNorm,
        taste: taste,
        novelty: novel,
        bayes: quality
      },
      warning: drop.warning,
      drop: drop.drop
    };
  }

  /**
   * 推荐主入口。
   * dishes: [{id, name, canteen, flavors:{...}, ratings:[...按时间升序]}]
   * opts: { profile, eatLog:{dishId: daysSinceLast}, weights, topK, maxPerCanteen, priorMean? }
   * 返回按分数降序、满足同食堂多样性约束的 Top-K 列表。
   */
  function recommend(dishes, opts) {
    opts = opts || {};
    var priorMean = typeof opts.priorMean === "number"
      ? opts.priorMean
      : pooledPriorMean(dishes);
    var scored = [];
    for (var i = 0; i < dishes.length; i++) {
      var d = dishes[i];
      var days = (opts.eatLog && Object.prototype.hasOwnProperty.call(opts.eatLog, d.id))
        ? opts.eatLog[d.id]
        : null;
      var s = scoreDish(d, {
        profile: opts.profile,
        priorMean: priorMean,
        weights: opts.weights,
        daysSinceLast: days,
        halfLifeDays: opts.halfLifeDays,
        tasteDropWindow: opts.tasteDropWindow,
        minRatingsForDrop: opts.minRatingsForDrop,
        tasteDropThreshold: opts.tasteDropThreshold
      });
      scored.push({ dish: d, score: s.score, detail: s.detail, warning: s.warning, drop: s.drop });
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    // 贪心套多样性约束：同一食堂最多 maxPerCanteen 个进 Top-K
    var topK = opts.topK || DEFAULTS.topK;
    var cap = typeof opts.maxPerCanteen === "number"
      ? opts.maxPerCanteen
      : DEFAULTS.maxPerCanteen;
    var perCanteen = {};
    var out = [];
    for (var j = 0; j < scored.length && out.length < topK; j++) {
      var c = scored[j].dish.canteen;
      perCanteen[c] = perCanteen[c] || 0;
      if (perCanteen[c] >= cap) continue;
      perCanteen[c]++;
      out.push(scored[j]);
    }
    return out;
  }

  return {
    DEFAULTS: DEFAULTS,
    mean: mean,
    bayesMean: bayesMean,
    buildTasteProfile: buildTasteProfile,
    cosine: cosine,
    freshness: freshness,
    recentDrop: recentDrop,
    pooledPriorMean: pooledPriorMean,
    scoreDish: scoreDish,
    recommend: recommend
  };
});
