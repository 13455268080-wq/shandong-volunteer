/**
 * 有数志愿 - 高考推荐引擎 v2
 * 趋势检测 + 位次预测 + 严格分桶 + 过度降档过滤
 */

// ============ 配置 ============
const CFG = {
  // 冲稳保兜底 位次比区间
  TIER: {
    rush:    { minRatio: 0.75, maxRatio: 0.95 },
    stable:  { minRatio: 0.95, maxRatio: 1.40 },
    safe:    { minRatio: 1.30, maxRatio: 2.00 },
    fallback:{ minRatio: 2.00, maxRatio: 3.00 }
  },
  // 加权系数
  BASE_WEIGHTS: { t1: 0.2, t2: 0.3, t3: 0.5 },
  // 趋势修正系数
  TREND: {
    hot_mult: 0.7,
    cold_mult: 0.5,
    zigzag_mult: 0.2
  },
  // 波动率阈值
  VOLATILITY: {
    low: 0.05,
    medium: 0.15
  },
  // 预测区间系数
  INTERVAL: {
    low: 0.03,
    medium: 0.06,
    high: 0.10
  },
  // 过滤
  MAX_RANK_RATIO: 3.0,
  DEFAULT_CANDIDATE_COUNT: 500000
};

// ============ 位次预处理 ============
function rankPreprocess(admissionRank, candidateCount) {
  var cc = candidateCount || CFG.DEFAULT_CANDIDATE_COUNT;
  var rankPct = admissionRank / cc;
  var logRank = Math.log(rankPct);
  return {
    rankPct: rankPct,
    logRank: logRank,
    candidateCount: cc,
    confidence: candidateCount ? 'high' : 'low'
  };
}

// ============ 趋势检测 ============
function trendDetector(y1_log, y2_log, y3_log) {
  if (y1_log == null || y2_log == null || y3_log == null) {
    return { isHot: false, isCold: false, isZigzag: false,
             trendSlope: 0, volatility: 0, volatilityLevel: 'high' };
  }
  var t1 = y2_log - y1_log;
  var t2 = y3_log - y2_log;
  var t3 = (y3_log - y1_log) / 2;
  // median
  var arr = [t1, t2, t3].sort(function(a,b){return a-b;});
  var slope = arr[1];
  // std
  var mean = (t1 + t2 + t3) / 3;
  var vol = Math.sqrt(((t1-mean)*(t1-mean) + (t2-mean)*(t2-mean) + (t3-mean)*(t3-mean)) / 3);

  // 分类
  var isHot = (t1 < 0 && t2 < 0);
  var isCold = (t1 > 0 && t2 > 0);
  var isZigzag = (t1 * t2 < 0);

  var vLevel;
  if (vol < CFG.VOLATILITY.low) vLevel = 'low';
  else if (vol < CFG.VOLATILITY.medium) vLevel = 'medium';
  else vLevel = 'high';

  return {
    isContinuousHot: isHot,
    isContinuousCold: isCold,
    isZigzag: isZigzag,
    trendSlope: slope,
    volatility: vol,
    volatilityLevel: vLevel,
    trend1: t1, trend2: t2
  };
}

// ============ 位次预测 (规则方法) ============
function rankPredictor(y1_log, y2_log, y3_log, trend, majorTrend, schoolTrend, planChange, candidateCount) {
  // 1. 基础加权
  var baseLogRank = CFG.BASE_WEIGHTS.t1 * y1_log +
                    CFG.BASE_WEIGHTS.t2 * y2_log +
                    CFG.BASE_WEIGHTS.t3 * y3_log;

  // 2. 趋势修正
  var trendAdj = 0;
  if (trend.isContinuousHot) {
    trendAdj = trend.trendSlope * CFG.TREND.hot_mult;
  } else if (trend.isContinuousCold) {
    trendAdj = trend.trendSlope * CFG.TREND.cold_mult;
  } else if (trend.isZigzag) {
    trendAdj = trend.trendSlope * CFG.TREND.zigzag_mult;
  }

  // 专业大类趋势增强/削弱
  var catAdj = 0;
  if (majorTrend != null) {
    if (trend.isContinuousHot && majorTrend.isHot) {
      trendAdj *= 1.3;
    }
    if (trend.isContinuousHot && !majorTrend.isHot) {
      trendAdj *= 0.7;
    }
  }

  // 学校趋势
  var schoolAdj = 0;
  if (schoolTrend != null) {
    schoolAdj = schoolTrend.slope * 0.2;
  }

  // 招生计划修正
  var planAdj = 0;
  if (planChange != null) {
    // 计划减少 → 位次提前(负修正)
    planAdj = planChange * 0.3;
  }

  // 中性预测
  var predLogRankQ50 = baseLogRank + trendAdj + catAdj + schoolAdj + planAdj;

  // 预测区间
  var intv;
  if (trend.volatilityLevel === 'low') intv = CFG.INTERVAL.low;
  else if (trend.volatilityLevel === 'medium') intv = CFG.INTERVAL.medium;
  else intv = CFG.INTERVAL.high;

  var predLogRankQ20 = predLogRankQ50 - intv;
  var predLogRankQ80 = predLogRankQ50 + intv;

  // 还原位次
  var cc = candidateCount || CFG.DEFAULT_CANDIDATE_COUNT;
  var predictedRankQ20 = Math.round(Math.exp(predLogRankQ20) * cc);
  var predictedRankQ50 = Math.round(Math.exp(predLogRankQ50) * cc);
  var predictedRankQ80 = Math.round(Math.exp(predLogRankQ80) * cc);

  return {
    q20: Math.max(1, predictedRankQ20),
    q50: Math.max(1, predictedRankQ50),
    q80: Math.max(1, predictedRankQ80),
    logQ50: predLogRankQ50,
    baseLogRank: baseLogRank,
    trendAdj: trendAdj,
    planAdj: planAdj,
    interval: intv
  };
}

// ============ 分桶 ============
function tierClassifier(studentRank, predictedRankQ50) {
  var ratio = predictedRankQ50 / studentRank;
  var tier = null;

  if (ratio >= CFG.TIER.rush.minRatio && ratio < CFG.TIER.rush.maxRatio) {
    tier = '冲';
  } else if (ratio >= CFG.TIER.rush.maxRatio && ratio <= CFG.TIER.stable.maxRatio) {
    // ratio 1.0 正好等于考生位次，归稳
    tier = '稳';
  } else if (ratio >= CFG.TIER.safe.minRatio && ratio <= CFG.TIER.safe.maxRatio) {
    tier = '保';
  } else if (ratio >= CFG.TIER.fallback.minRatio && ratio <= CFG.TIER.fallback.maxRatio) {
    tier = '兜底';
  }

  return { tier: tier, rankRatio: ratio };
}

// ============ 过度降档过滤 ============
function checkOverDowngrade(studentRank, predictedRankQ50, tier) {
  var ratio = predictedRankQ50 / studentRank;
  if (ratio > CFG.MAX_RANK_RATIO) return { pass: false, reason: 'rank_ratio > 3.0，过滤' };
  if (tier === '稳' && ratio > CFG.TIER.stable.maxRatio)
    return { pass: false, reason: '过度降档：位次比超稳上限，降为兜底', newTier: '兜底' };
  if (tier === '保' && ratio > CFG.TIER.safe.maxRatio)
    return { pass: false, reason: '过度降档：位次比超保上限，降为兜底', newTier: '兜底' };
  if (tier === '兜底' && ratio > CFG.TIER.fallback.maxRatio)
    return { pass: false, reason: '过度降档：超兜底上限，过滤', newTier: null };
  return { pass: true };
}

// ============ 风险估计 ============
function riskEstimator(trend, prediction, studentRank) {
  var riskLevel = 0; // 0=安全, 1=注意, 2=警告
  var labels = [];
  var isSafe = true;

  // Q20保守预测低于学生位次 → 有波动下滑风险
  if (prediction.q20 < studentRank && prediction.q50 >= studentRank) {
    riskLevel = Math.max(riskLevel, 1);
    labels.push('保守预测下位次可能提前，存在波动风险');
    isSafe = false;
  }

  if (trend.isContinuousHot) {
    riskLevel = Math.max(riskLevel, 2);
    labels.push('该专业近三年录取位次持续提前，存在继续上涨风险');
    isSafe = false;
  }

  if (trend.volatilityLevel === 'high') {
    riskLevel = Math.max(riskLevel, 2);
    labels.push('该专业近三年位次波动较大，不建议作为唯一保底');
    isSafe = false;
  }

  if (trend.isZigzag) {
    riskLevel = Math.max(riskLevel, 1);
    labels.push('该专业存在大小年波动，需谨慎判断');
  }

  if (trend.isContinuousCold) {
    labels.push('该专业近三年录取位次持续宽松');
  }

  return {
    riskLevel: riskLevel,
    riskLabel: riskLevel === 0 ? '安全' : riskLevel === 1 ? '注意' : '警告',
    labels: labels,
    isSafeAsCore: isSafe && riskLevel === 0
  };
}

// ============ 推荐解释 ============
function recommendationExplainer(item) {
  var reasons = [];
  var risks = [];
  var t = item.displayTier;

  if (t === '冲' || t === '冲稳') {
    reasons.push('该院校专业预测位次与考生位次接近，保守预测下存在一定风险，适合作为冲刺选择');
  } else if (t === '稳') {
    reasons.push('该院校专业预测位次与考生位次匹配度较高，安全边际合理');
  } else if (t === '保') {
    reasons.push('该院校专业录取安全性较高，但未明显过度降档');
  } else if (t === '兜底') {
    reasons.push('该院校专业与考生位次存在明显层次差距，仅建议作为极端情况的兜底选择');
  }

  if (item.trend && item.trend.isContinuousHot) {
    risks.push('近三年持续变热，录取位次可能继续提前');
  }
  if (item.trend && item.trend.volatilityLevel === 'high') {
    risks.push('位次波动大，预测不确定性高');
  }
  if (item.trend && item.trend.isZigzag) {
    risks.push('存在大小年波动');
  }

  return { reasons: reasons, risks: risks };
}

// ============ 主流程 ============
function buildRecommendationItem(rec, studentRank, threeYearData, majorTrend, schoolTrend, candidateCount) {
  var rr = rec.rank;
  if (!rr) return null;

  // 1. 预处理
  var pp = rankPreprocess(rr, candidateCount);

  // 2. 趋势检测
  var td = trendDetector(
    threeYearData ? threeYearData.y1_log : null,
    threeYearData ? threeYearData.y2_log : null,
    pp.logRank
  );

  // 3. 预测
  // 降级：如果没有三年数据，用两年数据填充
  var y1 = threeYearData ? threeYearData.y1_log : pp.logRank;
  var y2 = threeYearData ? threeYearData.y2_log : pp.logRank;
  var y3 = pp.logRank;

  var prediction = rankPredictor(y1, y2, y3, td, majorTrend, schoolTrend, null, candidateCount);

  // 4. 计算概率
  var prob = singleYearProb(rr, studentRank);

  // 5. 分桶（用原始位次，与展示一致；预测位次只用于趋势标签）
  var tc = tierClassifier(studentRank, rr);
  if (!tc.tier) return null;

  // 6. 过度降档检查
  var downgrade = checkOverDowngrade(studentRank, rr, tc.tier);
  if (!downgrade.pass) {
    if (downgrade.newTier) {
      tc.tier = downgrade.newTier;
    } else {
      return null; // 过滤
    }
  }

  // 7. 风险
  var risk = riskEstimator(td, prediction, studentRank);

  // 8. 最终概率调整
  if (rec.is985) prob += 2;
  if (rec.is211) prob += 1;
  if (rec.plan) {
    if (rec.plan >= 100) prob += 2;
    else if (rec.plan >= 50) prob += 1;
    else if (rec.plan <= 2) prob -= 2;
    else if (rec.plan <= 5) prob -= 1;
  }
  prob += getHeatAdjust(rec.major);
  prob = Math.round(Math.max(5, Math.min(99, prob)));

  return {
    school: rec.school,
    major: rec.major,
    batch: rec.batch,
    subject: rec.subject,
    plan: rec.plan,
    score: rec.score,
    rank: rr,
    is985: rec.is985,
    is211: rec.is211,
    probability: prob,
    displayRank: rr,
    // 新字段
    prediction: prediction,
    trend: td,
    risk: risk,
    rankRatio: tc.rankRatio,
    tier: tc.tier,
    qualityScore: rec.is985 ? 3 : rec.is211 ? 2 : 1,
    tuition: rec.tuition || 0
  };
}

// 简化的推荐解释（供前端展示）
function getTierExplanation(tier, trend, risk) {
  var lines = [];
  if (trend.isContinuousHot) lines.push('趋势：持续变热');
  if (trend.isContinuousCold) lines.push('趋势：持续宽松');
  if (trend.isZigzag) lines.push('趋势：大小年波动');
  if (trend.volatilityLevel === 'high') lines.push('波动：高');
  lines.push('风险：' + risk.riskLabel);
  return lines.join(' | ');
}
