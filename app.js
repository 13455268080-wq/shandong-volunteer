/**
 * 山东高考志愿填报 - 96志愿推荐系统
 * 基于三年录取数据，冲稳保概率推荐
 */

// ---- 数据加载 ----
const DATA_PARTS = ['data/rec2025_p0_t.json','data/rec2025_p1_t.json','data/rec2025_p2_t.json','data/rec2025_p3_t.json','data/rec2025_p4_t.json','data/rec2025_p5_t.json','data/rec2025_p6_t.json','data/rec2025_p7_t.json','data/rec2025_p8_t.json','data/rec2025_p9_t.json'];

const H = ['school','major','batch','subject','plan','score','rank','is985','is211','tuition'];
const H_TREND = ['school','major','rank','plan','category','batch','year'];

let mainData = [];
let trendData = [];
let trendIndex = {};
let rankScoreData = null;
let isLoading = false;
let dataLoaded = false;

let _lastResult = null;
let _lastRank = 0;
let _lastScore = null;
let _previewMode = true;

function expandRecord(arr) {
  const obj = {};
  H.forEach((k, i) => { obj[k] = arr[i]; });
  return obj;
}
function expandTrend(arr) {
  const obj = {};
  H_TREND.forEach((k, i) => { obj[k] = arr[i]; });
  return obj;
}

function buildTrendIndex(trendArr) {
  const idx = {};
  for (const entry of trendArr) {
    const rec = expandTrend(entry);
    const key = rec.school + '||' + rec.major;
    if (!idx[key]) idx[key] = [];
    idx[key].push(rec);
  }
  return idx;
}

async function loadRankScoreAsync() {
  try {
    var rsResp = await fetch('data/rank_to_score.json');
    if (rsResp.ok) rankScoreData = await rsResp.json();
  } catch(e) {}
}

async function loadData() {
  if (dataLoaded) return;
  var statusEl = document.getElementById('dataStatus');
  var barInner = document.querySelector('.loading-bar-inner');
  var btn = document.getElementById('queryButton');

  function step(msg, pct) {
    statusEl.textContent = msg;
    if (barInner) barInner.style.width = pct + '%';
  }

  step('加载中...', 5);

  try {
    mainData = [];
    var total = DATA_PARTS.length;
    for (var i = 0; i < total; i++) {
      step('加载' + (i+1) + '/' + total, 10 + (i * 8));
      var resp = await fetch(DATA_PARTS[i]);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var json = await resp.json();
      if (json.d) mainData = mainData.concat(json.d);
    }

    dataLoaded = true;
    step('就绪(' + mainData.length + '条)', 95);
    btn.disabled = false;
    btn.textContent = '查询录取建议';
    if (barInner) barInner.style.width = '100%';
    setTimeout(function() { barInner.style.width = '0%'; }, 800);

    // 后台加载趋势数据
    try {
      var tr = await fetch('data/trend_2023_2024.json');
      if (tr.ok) { var tj = await tr.json(); trendData = tj.d || []; trendIndex = buildTrendIndex(trendData); }
    } catch(e) {}
    try {
      var rr = await fetch('data/rank_to_score.json');
      if (rr.ok) rankScoreData = await rr.json();
    } catch(e) {}

  } catch (err) {
    step('失败: ' + err.message + ' 刷新重试', 0);
  }
}

function matchSubjects(requirement, studentSubjects) {
  if (!requirement || requirement === '不限' || requirement === '') return true;
  const subjects = studentSubjects.map(normalizeSubject);
  const req = requirement.replace(/,/g, '，').replace(/、/g, '，');
  if (req.includes('或')) {
    const parts = req.split('或').map(s => s.trim()).filter(Boolean);
    return parts.some(p => subjects.includes(normalizeSubject(p)));
  }
  if (req.includes('，')) {
    const parts = req.split('，').map(s => s.trim()).filter(Boolean);
    return parts.every(p => subjects.includes(normalizeSubject(p)));
  }
  return subjects.includes(normalizeSubject(req));
}

function normalizeSubject(s) {
  const map = { '思想政治': '政治', '思想': '政治' };
  return map[s] || s;
}

function singleYearProb(recordRank, studentRank) {
  if (!recordRank || recordRank <= 0) return null;
  const ratio = studentRank / recordRank;
  if (ratio <= 0.30) return 99;
  if (ratio <= 0.50) return 99 - (0.50-ratio)/0.20*8;
  if (ratio <= 0.70) return 91 - (0.70-ratio)/0.20*11;
  if (ratio <= 0.85) return 80 - (0.85-ratio)/0.15*12;
  if (ratio <= 0.95) return 68 - (0.95-ratio)/0.10*10;
  if (ratio <= 1.00) return 58 - (1.00-ratio)/0.05*8;
  if (ratio <= 1.05) return 50 - (1.05-ratio)/0.05*10;
  if (ratio <= 1.15) return 40 - (1.15-ratio)/0.10*14;
  if (ratio <= 1.30) return 26 - (1.30-ratio)/0.15*10;
  return Math.max(8, 16-(ratio-1.30)*10);
}

function calculateProbability(rec, studentRank, studentScore) {
  const weights = { 2025: 0.50, 2024: 0.30, 2023: 0.20 };
  let probs = [];
  let totalW = 0;
  if (rec.rank) {
    const p = singleYearProb(rec.rank, studentRank);
    if (p !== null) { probs.push(p * weights[2025]); totalW += weights[2025]; }
  }
  const trendKey = rec.school + '||' + rec.major;
  const trendEntries = trendIndex[trendKey];
  if (trendEntries) {
    for (const entry of trendEntries) {
      const w = weights[entry.year];
      if (w && entry.rank) {
        const p = singleYearProb(entry.rank, studentRank);
        if (p !== null) { probs.push(p * w); totalW += w; }
      }
    }
  }
  let prob = totalW > 0 ? probs.reduce((a,b) => a+b, 0) / totalW : 50;
  let notes = [];
  if (studentScore && rec.score && rec.rank && rec.rank > 0) {
    const d = studentScore - rec.score;
    if (d >= 15) prob += 4; else if (d >= 5) prob += 2; else if (d >= 0) prob += 1;
    else if (d >= -5) prob -= 1; else if (d >= -10) prob -= 3; else prob -= 5;
  }
  if (rec.is985) prob += 3;
  if (rec.is211) prob += 2;
  if (rec.plan) {
    if (rec.plan >= 100) prob += 4; else if (rec.plan >= 50) prob += 2;
    else if (rec.plan >= 20) prob += 1; else if (rec.plan <= 2) prob -= 4;
    else if (rec.plan <= 5) prob -= 2;
  }
  if (trendEntries && trendEntries.length >= 1) {
    notes.push('参考了3年数据加权');
  }
  return { probability: Math.round(Math.max(8, Math.min(99, prob))), notes: notes.join('；') };
}

function classifyByRatio(ratio, studentRank) {
  // ratio = student_rank / school_rank
  // ratio > 1.0 => 冲 (student worse than school, pressing luck)
  // ratio = 1.0 => 稳 (exactly equal)
  // ratio < 1.0 => 稳 (student better than school)
  // ratio < 1/1.4 => 保 (much better)

  // 冲: ratio strictly in (1.0, 1.25]
  // 稳: ratio in [1/稳下界, 1.0]
  // 保: ratio in [baoMax, 1/稳下界)

  // wenBottom = school_rank = student * N (稳的下界倍数)
  // baoBottom = school_rank = student * N (保的下界倍数)
  let wenBottom, baoBottom;

  if (studentRank < 2000) {
    wenBottom = 1/2.5;   // 稳: student*1.0 ~ student*2.5
    baoBottom = 1/5.0;   // 保: student*2.5 ~ student*5.0
  } else if (studentRank < 10000) {
    wenBottom = 1/2.0;
    baoBottom = 1/4.0;
  } else if (studentRank < 50000) {
    wenBottom = 1/1.5;
    baoBottom = 1/3.0;
  } else if (studentRank < 150000) {
    wenBottom = 1/1.4;
    baoBottom = 1/2.5;
  } else {
    wenBottom = 1/1.4;
    baoBottom = 1/2.0;
  }

  const CHONG_MIN = 1/0.8;  // 冲上限：school_rank = student * 0.8，ratio=1.25

  if (!ratio || ratio < baoBottom) return null;   // 低于保下界，太保底不取
  if (ratio < wenBottom) return '保';              // [baoBottom, wenBottom) => 保
  if (ratio <= 1.0) return '稳';                   // [wenBottom, 1.0] => 稳
  if (ratio <= CHONG_MIN) return '冲';              // (1.0, 1.25] => 冲
  return null;                                     // > 1.25 => 太冲不取
}

function classifyMajor(majorName) {
  if (!majorName) return 'other';
  const name = majorName;

  // 交叉专业（同时含理工和经管关键词），两边都不杀
  const crossKeywords = [
    '信息管理','工程管理','金融工程','金融数学','金融科技',
    '管理科学','工业工程','大数据管理','电子商务','物流工程',
    '生物统计','医学信息','数字媒体','地理信息科学'
  ];

  const artsKeywords = [
    '金融','会计','工商管理','市场营销','营销','经济','贸易',
    '法学','法律','新闻','传播','广告','外语','英语','日语',
    '俄语','法语','德语','中文','文学','历史','哲学','社会学',
    '社会工作','教育','心理','管理','行政','公共管理','艺术',
    '设计','音乐','美术','舞蹈','表演','影视','编导','播音',
    '主持','体育','运动','酒店管理','旅游管理','会展','文秘',
    '档案','图书情报','国际政治','外交','财务管理','审计',
    '资产评估','物流管理','电子商务','人力资源','物业管理',
    '文化产业','体育经济','税收','财政','保险','投资',
    '信用管理','房地产','土地资源','城市管理','海关','师范',
    '小学教育','学前教育','特殊教育'
  ];
  for (const kw of artsKeywords) {
    if (name.includes(kw)) {
      // 检查是否为交叉专业
      const isCross = crossKeywords.some(c => name.includes(c));
      return isCross ? 'cross' : 'arts';
    }
  }

  const scienceKeywords = [
    '工程','技术','计算机','软件','机械','电子','电气','自动化',
    '土木','建筑','数学','物理','化学','生物','医学','药学','临床',
    '口腔','护理','材料','能源','通信','信息','数据','人工智能',
    '智能','机器人','车辆','航空','航天','测绘','地质','环境',
    '水利','冶金','纺织','食品','农学','园林','园艺','动物医学',
    '水产','力学','光学','仪器','控制','动力','交通','船舶',
    '兵器','核工程','农业工程','林业','医学技术','康复','检验',
    '影像','生物医学','大数据','物联网','网络安全','软件工程',
    '微电子','集成电路','新能源','材料科学','遥感','地理信息',
    '城乡规划','工业设计','机械设计','车辆工程','制药','生物工程',
    '食品科学','植物生产','动物生产','水产养殖','草业'
  ];
  for (const kw of scienceKeywords) {
    if (name.includes(kw)) return 'science';
  }
  return 'other';
}

const KEYWORD_GROUPS = {
  '计算机': ['计算机','软件','人工智能','数据科学','大数据','网络工程','信息安全','物联网','智能科学','数字媒体','信息与计算科学'],
  '软件': ['软件','计算机','人工智能','数据科学','大数据','网络工程'],
  '人工智能': ['人工智能','智能','计算机','软件','数据科学','大数据','机器人','模式识别'],
  '电子': ['电子','通信','信息工程','集成电路','微电子','光电','电磁'],
  '机械': ['机械','自动化','车辆','机器人','智能制造','工业设计','材料成型'],
  '电气': ['电气','自动化','电力','能源与动力','新能源','电网'],
  '医学': ['医学','临床','口腔','药学','护理','康复','检验','影像','麻醉','预防','中医学','针灸'],
  '药学': ['药学','制药','药物','临床药学','中药'],
  '金融': ['金融','经济','会计','财务','投资','保险','税收','财政','审计'],
  '法学': ['法学','法律','知识产权','社会工作'],
  '外语': ['外语','英语','日语','俄语','法语','德语','翻译','商务英语'],
  '土木': ['土木','建筑','工程管理','工程造价','给排水','水利'],
  '通信': ['通信','信息工程','电子信息','信号','光电'],
  '自动化': ['自动化','控制','机器人','电气','智能制造'],
  '数据': ['数据','大数据','统计','人工智能','计算机'],
  '师范': ['师范','教育','小学教育','学前教育','特殊教育'],
  '生物': ['生物','生物工程','生物技术','生物医学','制药'],
  '材料': ['材料','材料科学','材料成型','高分子','冶金'],
  '环境': ['环境','生态','给排水','资源'],
  '新闻': ['新闻','传播','广告','网络与新媒体','编辑'],
  '艺术': ['艺术','设计','音乐','美术','舞蹈','表演','编导','播音'],
};
function expandKeyword(keyword) {
  if (!keyword) return [];
  const allTerms = new Set();
  for (const [group, terms] of Object.entries(KEYWORD_GROUPS)) {
    if (keyword.includes(group) || group.includes(keyword)) {
      terms.forEach(t => allTerms.add(t));
    }
  }
  if (allTerms.size === 0) allTerms.add(keyword);
  return [...allTerms];
}

function rankToScore(rank, year) {
  if (!rankScoreData || !rankScoreData[year || '2025'] || !rank) return null;
  const d = rankScoreData[year || '2025'];
  for (let i = 0; i < d.ranks.length; i++) {
    if (rank <= d.ranks[i]) return d.scores[i];
  }
  return d.scores[d.scores.length - 1];
}

/**
 * 核心：生成96志愿推荐
 */
function generateRecommendations(rank, score, subjects, batchFilter, keyword, categories, isMilitary) {
  if (!mainData || mainData.length === 0) {
    return { items: [], summary: { total: 0, chong: 0, wen: 0, bao: 0, selected: 0 } };
  }

  const militaryKeywords = ['国防','军','武警','军校','火箭军','战略支援','海军','空军','陆军'];

  let expandedKeywords = [];
  if (keyword) {
    expandedKeywords = expandKeyword(keyword);
  }

  const chong = [], wen = [], bao = [];

  for (const raw of mainData) {
    const rec = expandRecord(raw);

    if (isMilitary) {
      if (rec.batch !== '提前批') continue;
      if (!militaryKeywords.some(kw => rec.school.includes(kw))) continue;
    } else {
      if (batchFilter && rec.batch !== batchFilter) continue;
      if (!matchSubjects(rec.subject, subjects)) continue;
    }

    if (keyword) {
      const kw = keyword.toLowerCase();
      const text = (rec.school + rec.major + rec.batch).toLowerCase();
      const matchExpanded = expandedKeywords.some(term => text.includes(term));
      if (!matchExpanded) continue;
    }

    if (!rec.rank && !rec.score) continue;
    if (!rec.major) continue;
    if (rec.batch === '高职' && rank > 680000) continue;

    if (_selectedCities.length > 0) {
      var cityHit = false;
      var scm = window.SCHOOL_CITY;
      var mappedCity = (scm && scm[rec.school]) ? scm[rec.school] : '';
      for (var cix = 0; cix < _selectedCities.length; cix++) {
        var ct = _selectedCities[cix];
        if (mappedCity === ct) { cityHit = true; break; }
        if (rec.school.indexOf(ct) >= 0) { cityHit = true; break; }
      }
      if (!cityHit) continue;
    }
    if (_selectedCategories.length > 0 && typeof MAJOR_CATEGORIES !== 'undefined') {
      var catHit = false;
      for (var ai = 0; ai < MAJOR_CATEGORIES.length; ai++) {
        if (_selectedCategories.indexOf(MAJOR_CATEGORIES[ai].id) >= 0) {
          for (var ki = 0; ki < MAJOR_CATEGORIES[ai].keywords.length; ki++) {
            if (rec.major.indexOf(MAJOR_CATEGORIES[ai].keywords[ki]) >= 0) { catHit = true; break; }
          }
        }
        if (catHit) break;
      }
      if (!catHit) continue;
    }

    const ratio = rec.rank ? rank / rec.rank : null;
    if (ratio === null) continue;
    const tier = classifyByRatio(ratio, rank);
    if (!tier) continue;

    const { probability, notes } = calculateProbability(rec, rank, score);
    const qualityScore = rec.is985 ? 3 : rec.is211 ? 2 : 1;
    const item = { ...rec, probability, ratio, notes, tier, qualityScore };

    if (tier === '冲') chong.push(item);
    else if (tier === '稳') wen.push(item);
    else bao.push(item);
  }

  const sorter = (a, b) => b.qualityScore - a.qualityScore || b.ratio - a.ratio;
  chong.sort(sorter);
  wen.sort(sorter);
  bao.sort(sorter);

  const POOL_MULTIPLIER = 10;
  const chongPool = chong.slice(0, 19 * POOL_MULTIPLIER);
  const wenPool = wen.slice(0, 48 * POOL_MULTIPLIER);
  const baoPool = bao.slice(0, 29 * POOL_MULTIPLIER);

  function pickAndDedup(pool, targetCount, excludeSchools) {
    const result = [];
    const seen = new Set(excludeSchools);
    for (const item of pool) {
      if (result.length >= targetCount) break;
      if (seen.has(item.school)) continue;
      seen.add(item.school);
      result.push(item);
    }
    return result;
  }

  // 各档独立去重，所有合理范围内的全出，不设数量上限
  const chongPick = pickAndDedup(chongPool, 999, []);
  const wenPick = pickAndDedup(wenPool, 999, []);
  const baoPick = pickAndDedup(baoPool, 999, []);

  let finalItems = [...chongPick, ...wenPick, ...baoPick];

  for (const item of finalItems) {
    const pool = item.tier === '冲' ? chongPool : item.tier === '稳' ? wenPool : baoPool;
    item.children = [];
    const seen = new Set();
    for (const child of pool) {
      if (child.school === item.school && !seen.has(child.major)) {
        seen.add(child.major);
        item.children.push({
          major: child.major,
          probability: child.probability,
          ratio: child.ratio,
          rank: child.rank,
          plan: child.plan,
          tuition: child.tuition || 0,
          subject: child.subject || '',
        });
      }
    }
    if (item.children.length > 0) {
      var minRank = item.rank;
      for (var ci2 = 0; ci2 < item.children.length; ci2++) {
        if (item.children[ci2].rank && item.children[ci2].rank < minRank) minRank = item.children[ci2].rank;
      }
      item.displayRank = minRank;
    }
    item.childCount = item.children.length;
  }

  let idx = 1;
  const items = [
    ...chongPick.map(i => ({ ...i, displayIndex: idx++, displayTier: '冲' })),
    ...wenPick.map(i => ({ ...i, displayIndex: idx++, displayTier: '稳' })),
    ...baoPick.map(i => ({ ...i, displayIndex: idx++, displayTier: '保' })),
  ];

  const countMajors = (arr, tier) => arr.filter(i => i.displayTier === tier)
    .reduce((s, i) => s + (i.children ? i.children.length : 1), 0);
  const totalMajors = countMajors(items, '冲') + countMajors(items, '稳') + countMajors(items, '保');

  return {
    items,
    summary: {
      total: chong.length + wen.length + bao.length,
      chong: chong.length, wen: wen.length, bao: bao.length,
      selected: items.length,
      displayChong: chongPick.length,
      displayWen: wenPick.length,
      displayBao: baoPick.length,
      totalMajors,
    }
  };
}

// ---- UI ----

// 专业大类分类（专家设计，关键字智能匹配）
const MAJOR_CATEGORIES = [
  { id: 'cs', label: '计算机/AI', keywords: ['计算机','软件','人工智能','数据科学','大数据','网络工程','信息安全','物联网','智能科学','数字媒体技术','区块链工程','空间信息与数字技术','密码科学与技术'] },
  { id: 'ee', label: '电子信息/通信', keywords: ['电子信息','通信工程','信息工程','集成电路','微电子','光电信息','电磁场','电子科学与技术','电子信息工程','电子封装','柔性电子'] },
  { id: 'auto', label: '电气/自动化', keywords: ['电气工程','自动化','机器人工程','智能制造','智能电网','电力','能源与动力','新能源科学','核工程','能源互联网'] },
  { id: 'mech', label: '机械/土木/建筑', keywords: ['机械','车辆工程','智能制造工程','土木','建筑','水利','测绘','交通工程','船舶','航空航天','工程力学'] },
  { id: 'mat', label: '材料/化工', keywords: ['材料科学','材料成型','高分子','冶金','化学工程','轻化工程','纺织工程','非织造'] },
  { id: 'med1', label: '临床/口腔医学', keywords: ['临床医学','口腔医学','麻醉学','医学影像学','基础医学','预防医学','法医学','儿科学','精神医学'] },
  { id: 'med2', label: '药学/护理/医技', keywords: ['药学','护理学','康复治疗','医学检验技术','医学影像技术','制药工程','中药学','针灸推拿','卫生检验','眼视光'] },
  { id: 'stem', label: '数理化/统计', keywords: ['数学','物理学','化学','统计学','力学','光学','声学','应用物理学','数理基础科学'] },
  { id: 'bio', label: '生物/环境/农学', keywords: ['生物科学','生物技术','生态学','环境科学','环境工程','食品科学','农学','园林','园艺','动物医学','水产养殖','草业科学','地质学'] },
  { id: 'law', label: '法学/政治/社会', keywords: ['法学','知识产权','政治学','国际政治','外交学','社会工作','社会学','民族学','治安学','侦查学','海关管理'] },
  { id: 'econ', label: '经济/金融/管理', keywords: ['金融学','经济学','会计学','财务管理','审计学','保险学','投资学','税收学','财政学','国际经济与贸易','工商管理','人力资源管理','市场营销','物流管理','电子商务'] },
  { id: 'lang', label: '汉语言/外语', keywords: ['汉语言文学','汉语国际教育','英语','日语','俄语','法语','德语','西班牙语','翻译','商务英语','外国语言文学'] },
  { id: 'news', label: '新闻/传播', keywords: ['新闻学','传播学','广告学','网络与新媒体','广播电视学','编辑出版学','数字出版'] },
  { id: 'edu', label: '教育/心理', keywords: ['教育学','心理学','学前教育','小学教育','特殊教育','教育技术学','体育教育'] },
  { id: 'hist', label: '历史/哲学/艺术', keywords: ['历史学','哲学','考古学','文物与博物馆学','艺术学','设计学','音乐','美术','舞蹈','表演','戏剧','编导'] },
];

function initUI() {
  const subjects = ['物理','化学','生物','历史','地理','政治'];
  const container = document.getElementById('subjectsContainer');
  subjects.forEach(s => {
    const label = document.createElement('label');
    label.className = 'subject-chip';
    label.innerHTML = '<input type="checkbox" value="' + s + '">' + s;
    label.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        label.classList.toggle('selected');
        label.querySelector('input').checked = !label.querySelector('input').checked;
      }
    });
    container.appendChild(label);
  });

  // 城市选择标签
  var cityCt = document.getElementById('cityTags');
  if (cityCt) {
    CITY_LIST.forEach(function(city) {
      var lb = document.createElement('label');
      lb.className = 'subject-chip';
      lb.setAttribute('data-city', city);
      lb.textContent = city;
      lb.onclick = function() {
        this.classList.toggle('selected');
        _selectedCities = [];
        var all = document.querySelectorAll('#cityTags .subject-chip.selected');
        for (var cc = 0; cc < all.length; cc++) {
          _selectedCities.push(all[cc].getAttribute('data-city'));
        }
      };
      cityCt.appendChild(lb);
    });
  }

  // 专业大类标签
  var mtCt = document.getElementById('majorTags');
  if (mtCt && typeof MAJOR_CATEGORIES !== 'undefined') {
    MAJOR_CATEGORIES.forEach(function(cat) {
      var lb = document.createElement('label');
      lb.className = 'subject-chip';
      lb.setAttribute('data-cat', cat.id);
      lb.textContent = cat.label;
      lb.onclick = function() {
        this.classList.toggle('selected');
        _selectedCategories = [];
        var all = document.querySelectorAll('#majorTags .subject-chip.selected');
        for (var mj = 0; mj < all.length; mj++) {
          _selectedCategories.push(all[mj].getAttribute('data-cat'));
        }
      };
      mtCt.appendChild(lb);
    });
  }

  document.getElementById('queryButton').addEventListener('click', handleQuery);
  document.getElementById('newQueryButton').addEventListener('click', resetForm);

  document.getElementById('rankInput').addEventListener('input', (e) => {
    const rank = parseInt(e.target.value.trim(), 10);
    const si = document.getElementById('scoreInput');
    if (rank && !isNaN(rank) && rankScoreData) {
      const score = rankToScore(rank);
      si.placeholder = score ? '约' + score + '分（自动推算）' : '如有分数，可填写';
    } else {
      si.placeholder = '如有分数，可填写';
    }
  });

  document.querySelectorAll('input').forEach(el => {
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleQuery();
    });
  });
}

function getSelectedSubjects() {
  const chips = document.querySelectorAll('#subjectsContainer .subject-chip.selected');
  return Array.from(chips).map(function(c){ return c.querySelector('input').value; });
}

let _selectedCategories = [];
let _selectedCities = [];
let _isMilitary = false;

const CITY_LIST = ['济南','青岛','烟台','威海','潍坊','淄博','泰安','临沂','济宁','聊城','菏泽','德州','滨州','东营','日照','枣庄','北京','上海','广州','深圳','成都','杭州','武汉','西安','南京','长沙','天津','重庆','苏州','郑州','合肥','哈尔滨','沈阳','长春','大连','厦门'];

function toggleMode() {
  _previewMode = !_previewMode;
  var el = document.getElementById('modeToggle');
  if (el) el.innerHTML = _previewMode ? '预览版' : '完整版';
  if (_lastResult) renderResults(_lastResult, _lastRank, _lastScore);
}

function handleQuery() {
  const rank = parseInt(document.getElementById('rankInput').value.trim(), 10);
  const score = parseInt(document.getElementById('scoreInput').value.trim(), 10) || null;
  const batch = document.getElementById('batchSelect').value;
  const keyword = document.getElementById('keywordInput').value.trim();
  const subjects = getSelectedSubjects();

  if (!rank || isNaN(rank) || rank <= 0) {
    alert('请输入有效的高考位次（必填）');
    return;
  }
  if (subjects.length === 0) {
    alert('请选择你的选科科目（至少选1科）');
    return;
  }
  if (subjects.length > 3) {
    alert('选科最多选3科（山东3+3模式）');
    return;
  }
  if (!dataLoaded) {
    alert('数据正在加载中，请稍后再试');
    return;
  }

  const result = generateRecommendations(rank, score, subjects, batch, keyword, _selectedCategories, _isMilitary);
  _lastResult = result;
  _lastRank = rank;
  _lastScore = score;
  renderResults(result, rank, score);
}

function renderResults(result, rank, score) {
  const area = document.getElementById('resultArea');
  area.classList.add('visible');

  if (result.items.length === 0) {
    area.innerHTML = [
      '<div class="panel">',
      '<div class="empty-state">',
      '<strong>未找到匹配的志愿</strong>',
      '<p>可能原因：位次过小或过大、选科匹配无结果、无相关批次数据</p>',
      '<p style="font-size:0.85rem;color:var(--text-muted)">建议尝试：放宽批次限制、不填关键词、或选择更多选科组合</p>',
      '</div></div>'
    ].join('\n');
    return;
  }

  const s = result.summary;
  const statsHtml = [
    '<div class="summary-bar">',
    '<div class="summary-stat"><strong>' + (s.totalMajors || s.selected) + '</strong><span>推荐专业（' + s.selected + '所院校）</span></div>',
    '<div class="summary-stat"><strong style="color:var(--chong)">' + (s.displayChong || s.chong) + '</strong><span>冲刺院校</span></div>',
    '<div class="summary-stat"><strong style="color:var(--wen)">' + (s.displayWen || s.wen) + '</strong><span>稳妥院校</span></div>',
    '<div class="summary-stat"><strong style="color:var(--bao)">' + (s.displayBao || s.bao) + '</strong><span>保底院校</span></div>',
    '<div class="summary-stat"><strong>' + rank.toLocaleString() + '</strong><span>位次' + (score ? ' / ' + score + '分' : '') + '</span></div>',
    '</div>'
  ].join('\n');

  var chongItems = result.items.filter(i => i.displayTier === '冲');
  var wenItems = result.items.filter(i => i.displayTier === '稳');
  var baoItems = result.items.filter(i => i.displayTier === '保');
  if (_previewMode) { chongItems = chongItems.slice(0, 3); wenItems = wenItems.slice(0, 3); baoItems = baoItems.slice(0, 3); }

  const majorCount = (items) => items.reduce((s, i) => s + (i.children ? i.children.length : 1), 0);
  const mc = majorCount(chongItems), mw = majorCount(wenItems), mb = majorCount(baoItems);

  const renderItem = (item) => {
    var hasChildren = item.children && item.children.length > 1;
    var majorText;
    if (_previewMode) {
      hasChildren = false;
      majorText = item.major || (item.children && item.children.length > 0 ? item.children[0].major : '');
    } else {
      majorText = hasChildren
        ? item.children.slice(0, 3).map(function(c){return c.major;}).join('、') + (item.children.length > 3 ? ' 等' + item.children.length + '个专业' : '')
        : (item.major || '');
    }
    const tierClass = item.displayTier === '冲' ? 'chong' : item.displayTier === '稳' ? 'wen' : 'bao';
    const tags = (item.is985 ? ' <span class="tag tag-985">985</span>' : '') +
      (item.is211 ? ' <span class="tag tag-211">211</span>' : '') +
      ((item.is985 || item.is211) ? ' <span class="tag tag-double">双一流</span>' : '');

    let html = [
      '<div class="volunt-item tier-' + tierClass + '">',
      '<div class="index">',
      (_previewMode ? '' : '<input type="checkbox" class="item-check" data-idx="' + item.displayIndex + '" checked onchange="updateCheckedCount()" style="width:14px;height:14px;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation()">'),
      hasChildren ? '<span class="expand-btn">▶</span>' : '',
      '<span>' + item.displayIndex + '</span>',
      '</div>',
      '<div class="info">',
      '<div class="school">' + item.school + tags + '</div>',
      '<div class="major">' + majorText + '</div>',
      '</div>',
      '<div class="prob">' + (hasChildren ? '<span style="font-size:0.72rem;color:var(--text-muted)">展开▶</span>' : '<span>' + item.probability + '%</span><div class="prob-fill" style="width:' + item.probability + '%"></div>') + '</div>',
      '<div class="rank">' + (hasChildren ? '' : (item.rank ? '位次 ' + item.rank.toLocaleString() : '')) + '</div>',
      '<div class="plan" style="font-size:0.75rem" title="学费/年">' + (item.tuition && item.tuition > 0 ? (item.tuition/10000).toFixed(2)+'万' : '-') + '</div>',
      '<div class="plan">计划 ' + (item.plan || '-') + '</div>',
      '</div>'
    ].join('\n');

    if (hasChildren) {
      html += '<div class="volunt-children">';
      item.children.forEach((c, i) => {
        html += [
          '<div class="volunt-child tier-' + tierClass + '">',
          (_previewMode ? '' : '<input type="checkbox" class="child-check" data-parent="' + item.school + '" data-major="' + c.major + '" checked onchange="updateCheckedCount()" style="width:12px;height:12px;cursor:pointer;flex-shrink:0" onclick="event.stopPropagation()">'),
          '<div class="child-major">' + (i + 1) + '. ' + c.major + (c.subject && c.subject !== '不限' ? ' <span class="tag">' + c.subject + '</span>' : '') + (c.trend && c.trend.isContinuousHot ? ' <span class="tag" style="background:#fee2e2;color:#dc2626">变热</span>' : '') + (c.trend && c.trend.volatilityLevel === 'high' ? ' <span class="tag" style="background:#fef3c7;color:#92400e">波动</span>' : '') + '</div>',
          '<div class="child-prob">' + (c.probability != null ? c.probability : item.probability) + '%</div>',
          '<div class="child-rank">' + (c.rank ? '位次 ' + c.rank.toLocaleString() : '') + '</div>',
          '<div class="child-plan" style="font-size:0.72rem" title="学费/年">' + (c.tuition && c.tuition > 0 ? (c.tuition/10000).toFixed(2)+'万' : '-') + '</div>',
          '<div class="child-plan">计划 ' + (c.plan || '-') + '</div>',
          '</div>'
        ].join('\n');
      });
      html += '</div>';
    }
    return html;
  };

  const renderTier = (items, label, cssClass, desc) => {
    if (items.length === 0) return '';
    return [
      '<div class="tier-header ' + cssClass + '">',
      '<span>' + label + '（' + items.length + '所院校）</span>',
      '<span class="tier-desc">' + desc + '</span>',
      '</div>',
      items.map(renderItem).join('')
    ].join('\n');
  };

  area.innerHTML = [
    '<div class="panel">',
    statsHtml,
    '<div class="volunt-list">',
    renderTier(chongItems, '冲刺志愿', 'chong', mc + '个专业 位次约考生*0.8~1.0'),
    renderTier(wenItems, '稳妥志愿', 'wen', mw + '个专业 位次约考生*1.0~1.4'),
    renderTier(baoItems, '保底志愿', 'bao', mb + '个专业 位次约考生*1.4~2.5'),
    '</div>',
    '<div class="footer-note">',
    '<strong>录取概率说明：</strong><br>',
    '1. 冲稳保按ratio区间划分：冲(院校位次=考生*0.8~1.0) | 稳(*1.0~1.4) | 保(*1.4~2.5)，比例2:5:3<br>',
    '2. 每档内按 985 > 211 > 双非 排序，同院校不重复（点击行展开查看各专业详情）<br>',
    '3. 录取概率 = 三年加权(2025年50%+2024年30%+2023年20%)<br>',
    '4. <strong style="color:var(--chong)">本系统仅供参考，请以官方信息为准</strong>',
    '</div></div>',
    '<div class="panel" style="text-align:center;padding:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">',
    (_previewMode ? '' : '<div class="panel" style="padding:16px"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-weight:600;font-size:0.9rem">审核设置</span><label style="font-size:0.85rem;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="selectAllCheck" onchange="toggleSelectAll(this.checked)" checked> 全选</label><span style="color:var(--text-muted);font-size:0.8rem">已选 <strong id="checkedCount">' + result.items.length + '</strong></span><label style="font-size:0.85rem;margin-left:8px">审核学长：<input id="reviewerName" type="text" placeholder="选填" style="width:120px;padding:5px 8px;font-size:0.85rem;border-radius:6px;border:1px solid #e2e8f0"></label></div><div style="margin-top:6px;font-size:0.75rem;color:var(--text-muted)">勾选需要导出/打印的志愿</div></div>'),
    '<button class="btn-primary" onclick="document.getElementById(\'rankInput\').focus();window.scrollTo({top:0,behavior:\'smooth\'})">查询另一个考生</button>',
    '<button class="btn-secondary" onclick="exportToExcel()">导出Excel志愿表</button>',
    '<span style="color:var(--text-muted);font-size:0.85rem;">直接修改条件重新查询即可，无需刷新页面</span>',
    '</div>',
    (_previewMode ? '<div class="panel" style="padding:20px;text-align:center;background:linear-gradient(135deg,#fef2f2,#eef2ff);border:2px dashed var(--primary-light);border-radius:12px"><div style="font-size:1.1rem;font-weight:700;margin-bottom:6px">以上为免费预览，每档仅展示3所代表性院校</div><div style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:8px">完整志愿+趋势预测+风险分析+学长真人复核</div><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><span style="background:#fff;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.9rem">微信公众号：有数志愿</span><span style="background:var(--primary);color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;font-size:0.9rem">咨询获取完整版</span></div></div>' : '')
  ].join('\n');

  area.querySelectorAll('.volunt-item').forEach(row => {
    row.addEventListener('click', (e) => {
      const children = row.nextElementSibling;
      if (!children || !children.classList.contains('volunt-children')) return;
      const btn = row.querySelector('.expand-btn');
      children.classList.toggle('visible');
      if (btn) btn.classList.toggle('expanded');
    });
  });

  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  document.getElementById('rankInput').value = '';
  document.getElementById('scoreInput').value = '';
  document.getElementById('batchSelect').value = '';
  document.getElementById('keywordInput').value = '';
  _selectedCategories = [];
  _selectedCategories = [];
  _selectedCities = [];
  _isMilitary = false;
  var mtt = document.getElementById('majorTags');
  if (mtt) { mtt.querySelectorAll('.subject-chip.selected').forEach(function(el){el.classList.remove('selected');}); }
  var ct = document.getElementById('cityTags');
  if (ct) { ct.querySelectorAll('.subject-chip.selected').forEach(function(el){el.classList.remove('selected');}); }
  document.querySelectorAll('.subject-chip.selected').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input').checked = false;
  });
  document.getElementById('resultArea').classList.remove('visible');
  document.getElementById('resultArea').innerHTML = '';
  document.getElementById('rankInput').focus();
}

function exportToExcel() {
  var items = getCheckedItems();
  if (items.length === 0) { alert('请至少勾选一个志愿'); return; }
  if (typeof XLSX === 'undefined') {
    alert('Excel导出库未加载，请刷新页面后重试');
    return;
  }

  const result = _lastResult;
  const rank = _lastRank;
  const score = _lastScore;

  const rows = [
    ['山东高考志愿填报助手 - 导出志愿表'],
    [],
    ['考生位次', rank],
    ['考生分数', score || '未填写'],
    ['生成时间', new Date().toLocaleString('zh-CN')],
    [],
    ['序号','档次','院校名称','专业','选科要求','批次','录取概率','最低位次','计划数','标签'],
  ];

  for (const item of result.items) {
    const majors = item.children && item.children.length > 1
      ? item.children.map(c => c.major).join('；')
      : (item.major || '');
    const labels = [item.is985 ? '985' : '', item.is211 ? '211' : '', (item.is985 || item.is211) ? '双一流' : ''].filter(Boolean).join(' ');
    rows.push([item.displayIndex, item.displayTier, item.school, majors, item.subject||'', item.batch||'', item.probability+'%', item.rank||'', item.plan||'', labels]);
    if (item.children && item.children.length > 1) {
      for (const c of item.children) {
        rows.push(['','','','  └ ' + c.major, c.subject||'', '', c.probability+'%', c.rank||'', c.plan||'', '']);
      }
      rows.push([]);
    }
  }

  rows.push([],['统计'],['总推荐数', result.summary.selected],['冲刺', result.summary.displayChong || result.summary.chong],['稳妥', result.summary.displayWen || result.summary.wen],['保底', result.summary.displayBao || result.summary.bao]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:6},{wch:6},{wch:22},{wch:40},{wch:12},{wch:10},{wch:10},{wch:12},{wch:10},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '志愿推荐');
  XLSX.writeFile(wb, '山东高考志愿推荐表.xlsx');
}

window.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadData();
});
