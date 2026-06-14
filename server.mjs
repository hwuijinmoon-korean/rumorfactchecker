import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());


function getMetaContent(document, selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const content = el?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return '';
}

function cleanText(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

function getFirstParagraph(text = '') {
  const paragraphs = text
    .split('\n')
    .map((p) => cleanText(p))
    .filter(Boolean);

  return paragraphs[0] || '';
}

function hostnameToPublisher(urlString) {
  try {
    const hostname = new URL(urlString).hostname.replace('www.', '');
    const base = hostname.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return '';
  }
}

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  console.log('incoming url:', url);

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: '유효한 URL이 필요합니다.' });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 15000,
    });

    console.log('fetch success status:', response.status);

    const dom = new JSDOM(response.data, { url });
    const document = dom.window.document;

    const reader = new Readability(document);
    const article = reader.parse();

    console.log('readability parsed:', !!article);

    const headline =
      cleanText(
        getMetaContent(document, [
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
        ])
      ) ||
      cleanText(article?.title) ||
      cleanText(document.querySelector('title')?.textContent || '');

    const summary =
      cleanText(
        getMetaContent(document, [
          'meta[name="description"]',
          'meta[property="og:description"]',
          'meta[name="twitter:description"]',
        ])
      ) ||
      cleanText(article?.excerpt) ||
      getFirstParagraph(article?.textContent || '');

    const body =
      cleanText(article?.textContent || '') ||
      Array.from(document.querySelectorAll('p'))
        .map((p) => cleanText(p.textContent || ''))
        .filter((text) => text.length > 30)
        .join('\n\n');

    const publisher =
      cleanText(
        getMetaContent(document, [
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
        ])
      ) || hostnameToPublisher(url);

    const author =
      cleanText(
        getMetaContent(document, [
          'meta[name="author"]',
          'meta[property="article:author"]',
        ])
      ) ||
      cleanText(article?.byline || '');

    const result = {
      headline,
      summary,
      body,
      publisher,
      author,
    };

    console.log('extract result preview:', {
      headline: result.headline?.slice(0, 80),
      summary: result.summary?.slice(0, 80),
      bodyLength: result.body?.length,
      publisher: result.publisher,
      author: result.author,
    });

    return res.json(result);
  } catch (error) {
    console.error('extract route error:');

    if (axios.isAxiosError(error)) {
      console.error('axios status:', error.response?.status);
      console.error('axios message:', error.message);
      console.error('axios data:', error.response?.data);
    } else {
      console.error(error);
    }

    return res.status(500).json({
      error: '기사 내용을 불러오지 못했습니다. 사이트 차단 또는 파싱 실패일 수 있습니다.',
    });
  }
});

const CACHE_FILE = path.join(process.cwd(), 'market-cache.json');
const KRX_FILE = path.join(process.cwd(), 'krx_stocks.csv');

function toYahooTicker(code, market) {
  const paddedCode = String(code).padStart(6, '0');

  if (market === 'KOSDAQ') {
    return `${paddedCode}.KQ`;
  }

  return `${paddedCode}.KS`;
}

function loadStockUniverseFromCsv() {
  if (!fs.existsSync(KRX_FILE)) {
    throw new Error('krx_stocks.csv 파일이 없습니다. 프로젝트 루트에 생성해 주세요.');
  }

  const csvText = fs.readFileSync(KRX_FILE, 'utf-8');

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  return records
    .filter((row) => row.code && row.name)
    .map((row) => ({
      code: String(row.code).padStart(6, '0'),
      name: row.name,
      market: row.market || 'KOSPI',
      ticker: toYahooTicker(row.code, row.market || 'KOSPI'),
    }));
}

function countOccurrences(text, keyword) {
  if (!text || !keyword) return 0;

  const escapedKeyword = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(text).match(new RegExp(escapedKeyword, 'gi'));

  return matches ? matches.length : 0;
}


function inferTargetTickerFromUniverse(text, universe, events = []) {
  const fullText = String(text || '');
  const normalizedText = fullText.toLowerCase();

  const sections = fullText.split('\n');
  const headlineText = sections[0] || '';
  const summaryText = sections[1] || '';
  const bodyText = sections.slice(2).join('\n') || '';

  const normalizedStockUniverse = [...universe]
  .filter((stock) => stock.name)
  .sort((a, b) => String(b.name).length - String(a.name).length);

const mentionedCandidates = normalizedStockUniverse
  .map((stock) => {
      const stockName = String(stock.name);
      const lowerName = stockName.toLowerCase();

      const alreadyMatchedLongerName = normalizedStockUniverse.some((otherStock) => {
  const otherName = String(otherStock.name);

  return (
    otherName.length > stockName.length &&
    otherName.includes(stockName) &&
    fullText.includes(otherName)
  );
});

if (alreadyMatchedLongerName) return null;

const headlineCount = countOccurrences(headlineText, stockName);
const summaryCount = countOccurrences(summaryText, stockName);
const bodyCount = countOccurrences(bodyText, stockName);
      const totalCount = headlineCount + summaryCount + bodyCount;

      if (totalCount === 0) return null;

      const score =
        headlineCount * 5 +
        summaryCount * 3 +
        bodyCount * 1 +
        totalCount * 1 +
        stockName.length * 0.1;

      return {
        stock,
        score,
        headlineCount,
        summaryCount,
        bodyCount,
        totalCount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (mentionedCandidates.length > 0) {
    const best = mentionedCandidates[0];

    return {
      ticker: best.stock.ticker,
      reason:
        `뉴스에 직접 언급된 종목 중 "${best.stock.name}"이 가장 높은 관련도 점수를 보여 기준 종목으로 선택했습니다. ` ,
      type: 'mentioned_scored',
    };
  }

  const representativeRules = [
    {
      condition:
        events.includes('전쟁') ||
        events.includes('유가') ||
        events.includes('원자재') ||
        normalizedText.includes('원유') ||
        normalizedText.includes('석유') ||
        normalizedText.includes('중동'),
      names: ['S-Oil', 'SK이노베이션', 'GS', '한국석유', '중앙에너비스', '흥구석유'],
      reason: '전쟁·유가·원자재 이벤트와 관련된 에너지/정유 대표 종목을 기준으로 선택했습니다.',
    },
    {
      condition:
        events.includes('금리') ||
        events.includes('인플레이션') ||
        events.includes('환율') ||
        events.includes('금융시장') ||
        events.includes('신용리스크'),
      names: ['KB금융', '신한지주', '하나금융지주', '우리금융지주', '기업은행'],
      reason: '금리·환율·금융시장 이벤트와 관련된 금융 대표 종목을 기준으로 선택했습니다.',
    },
    {
      condition:
        normalizedText.includes('반도체') ||
        normalizedText.includes('chip') ||
        normalizedText.includes('semiconductor') ||
        normalizedText.includes('ai'),
      names: ['삼성전자', 'SK하이닉스', '한미반도체', 'DB하이텍'],
      reason: '반도체/AI 산업 이벤트와 관련된 대표 종목을 기준으로 선택했습니다.',
    },
    {
      condition:
        normalizedText.includes('우주') ||
        normalizedText.includes('항공') ||
        normalizedText.includes('스페이스x') ||
        normalizedText.includes('spacex') ||
        normalizedText.includes('방산'),
      names: ['한국항공우주', '한화에어로스페이스', 'LIG넥스원', '쎄트렉아이'],
      reason: '우주항공/방산 산업 이벤트와 관련된 대표 종목을 기준으로 선택했습니다.',
    },
    {
      condition:
        normalizedText.includes('자동차') ||
        normalizedText.includes('전기차') ||
        normalizedText.includes('배터리'),
      names: ['현대차', '기아', 'LG에너지솔루션', '삼성SDI', '에코프로비엠'],
      reason: '자동차/전기차/배터리 이벤트와 관련된 대표 종목을 기준으로 선택했습니다.',
    },
    {
      condition:
        normalizedText.includes('바이오') ||
        normalizedText.includes('제약') ||
        normalizedText.includes('헬스케어'),
      names: ['삼성바이오로직스', '셀트리온', '유한양행', '한미약품'],
      reason: '바이오/제약 이벤트와 관련된 대표 종목을 기준으로 선택했습니다.',
    },
  ];

  for (const rule of representativeRules) {
    if (!rule.condition) continue;

    const representativeStock = universe.find((stock) =>
      rule.names.some((name) => String(stock.name).includes(name))
    );

    if (representativeStock) {
      return {
        ticker: representativeStock.ticker,
        reason: rule.reason,
        type: 'event_representative',
      };
    }
  }

  const samsung = universe.find((stock) => stock.code === '005930');

  if (samsung) {
    return {
      ticker: samsung.ticker,
      reason: '직접 언급 종목과 이벤트 대표 종목이 없어 KOSPI 대표 종목인 삼성전자를 기준으로 선택했습니다.',
      type: 'default',
    };
  }

  const firstKospi = universe.find((stock) => stock.market === 'KOSPI');

  return {
    ticker: firstKospi?.ticker || universe[0]?.ticker || '005930.KS',
    reason: '직접 언급 종목과 대표 종목을 찾지 못해 사용 가능한 첫 번째 종목을 기준으로 선택했습니다.',
    type: 'fallback',
  };
}

function getUnixTime(dateString) {
  return Math.floor(new Date(dateString).getTime() / 1000);
}

async function fetchYahooPrices(ticker) {
  // 최근 1년 자동
const today = new Date();
const oneYearAgo = new Date();
oneYearAgo.setMonth(today.getMonth() - 6);

const period1 = Math.floor(oneYearAgo.getTime() / 1000);
const period2 = Math.floor(today.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;

  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: 5000,
  });

  const result = response.data.chart.result?.[0];

  if (!result) {
    throw new Error(`${ticker} 가격 데이터를 불러오지 못했습니다.`);
  }

  const timestamps = result.timestamp || [];
  const closes = result.indicators.quote[0].close || [];

  return timestamps
    .map((time, index) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      close: closes[index],
    }))
    .filter((item) => item.close !== null && item.close !== undefined);
}

function calculateReturns(priceData) {
  const returns = [];

  for (let i = 1; i < priceData.length; i++) {
    const prev = priceData[i - 1].close;
    const curr = priceData[i].close;

    if (prev && curr) {
      returns.push({
        date: priceData[i].date,
        return: (curr - prev) / prev,
      });
    }
  }

  return returns;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length === 0) return 0;

  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
    values.length;

  return Math.sqrt(variance);
}

function correlation(a, b) {
  const length = Math.min(a.length, b.length);

  if (length < 30) return 0;

  const x = a.slice(-length);
  const y = b.slice(-length);

  const meanX = mean(x);
  const meanY = mean(y);

  const numerator = x.reduce(
    (sum, value, index) => sum + (value - meanX) * (y[index] - meanY),
    0
  );

  const denominator =
    Math.sqrt(x.reduce((sum, value) => sum + Math.pow(value - meanX, 2), 0)) *
    Math.sqrt(y.reduce((sum, value) => sum + Math.pow(value - meanY, 2), 0));

  return denominator === 0 ? 0 : numerator / denominator;
}

function normalizeFeature(value, min, max) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function eventSensitivity(events, volatility, marketCorrelation) {
  if (events.includes('전쟁') || events.includes('유가') || events.includes('원자재')) {
    return volatility * 0.7 + Math.abs(marketCorrelation) * 0.3;
  }

  if (events.includes('금리') || events.includes('인플레이션') || events.includes('환율')) {
    return Math.abs(marketCorrelation) * 0.6 + volatility * 0.4;
  }

  return volatility * 0.5 + Math.abs(marketCorrelation) * 0.5;
}

function euclideanDistance(a, b) {
  return Math.sqrt(
    a.reduce((sum, value, index) => sum + Math.pow(value - b[index], 2), 0)
  );
}

function meanVector(vectors) {
  const length = vectors[0].length;

  return Array.from({ length }, (_, index) => {
    const sum = vectors.reduce((acc, vector) => acc + vector[index], 0);
    return sum / vectors.length;
  });
}

function simpleKMeans(data, k = 7, maxIterations = 30) {
  const safeK = Math.min(k, data.length);
  let centroids = data.slice(0, safeK).map((item) => [...item.features]);
  let assignments = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    assignments = data.map((item) => {
      const distances = centroids.map((centroid) =>
        euclideanDistance(item.features, centroid)
      );

      return distances.indexOf(Math.min(...distances));
    });

    centroids = centroids.map((centroid, clusterIndex) => {
      const clusterItems = data
        .filter((_, itemIndex) => assignments[itemIndex] === clusterIndex)
        .map((item) => item.features);

      if (clusterItems.length === 0) return centroid;

      return meanVector(clusterItems);
    });
  }

  return data.map((item, index) => ({
    ...item,
    cluster: assignments[index],
  }));
}

function eventImpactMessage(events) {
  if (events.includes('전쟁') || events.includes('유가')) {
    return '전쟁/유가 이벤트가 탐지되어 유가·원자재·수출 민감도가 높은 종목군을 중심으로 군집을 해석합니다.';
  }

  if (events.includes('금리') || events.includes('인플레이션')) {
    return '금리/물가 이벤트가 탐지되어 시장 상관도와 변동성이 높은 종목군을 중심으로 군집을 해석합니다.';
  }

  if (events.includes('산업')) {
    return '산업 이벤트가 탐지되어 유사한 수익률 패턴을 보이는 종목군을 중심으로 군집을 해석합니다.';
  }

  return '탐지된 이벤트와 실제 주가 수익률 패턴을 기준으로 유사 종목군을 분석합니다.';
}

function readMarketCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;

  const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeMarketCache(cacheData) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
}

async function buildMarketCache() {
  const universe = loadStockUniverseFromCsv();

  if (universe.length === 0) {
    throw new Error('krx_stocks.csv에 종목이 없습니다.');
  }

  const oldCache = readMarketCache();
  const oldStocks = oldCache?.stocks || [];

  const oldStockMap = new Map(
    oldStocks.map((stock) => [stock.ticker, stock])
  );

  const marketPrices = await fetchYahooPrices('^KS200');
  const marketReturns = calculateReturns(marketPrices).map(
    (item) => item.return
  );

  const rawFeatureData = [];
  let reusedCount = 0;
  let addedCount = 0;
  let skippedCount = 0;

  const BATCH_SIZE = 25;
  const totalBatchCount = Math.ceil(universe.length / BATCH_SIZE);

  for (let i = 0; i < universe.length; i += BATCH_SIZE) {
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const batch = universe.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (stock) => {
      const cachedStock = oldStockMap.get(stock.ticker);

      if (cachedStock) {
        return {
          type: 'reused',
          stock: cachedStock,
        };
      }

      try {
        const prices = await fetchYahooPrices(stock.ticker);
        const returns = calculateReturns(prices).map((item) => item.return);

        if (returns.length < 40) {
          return {
            type: 'skipped',
            stock: null,
          };
        }

        const marketCorrelation = correlation(returns, marketReturns);
        const volatility = standardDeviation(returns);

        return {
          type: 'added',
          stock: {
            code: stock.code,
            ticker: stock.ticker,
            name: stock.name,
            market: stock.market,
            marketCorrelation,
            volatility,
          },
        };
      } catch (error) {
        return {
          type: 'skipped',
          stock: null,
        };
      }
    });

    const results = await Promise.all(promises);

    for (const result of results) {
      if (result.type === 'reused' && result.stock) {
        reusedCount += 1;
        rawFeatureData.push(result.stock);
      }

      if (result.type === 'added' && result.stock) {
        addedCount += 1;
        rawFeatureData.push(result.stock);
      }

      if (result.type === 'skipped') {
        skippedCount += 1;
      }
    }

    const partialCacheData = {
      createdAt: new Date().toISOString(),
      count: rawFeatureData.length,
      reusedCount,
      addedCount,
      skippedCount,
      stocks: rawFeatureData,
    };

    writeMarketCache(partialCacheData);

    console.log(
      `batch ${batchNumber}/${totalBatchCount} 완료 | 분석 가능 ${rawFeatureData.length}개 | 추가 ${addedCount}개 | 재사용 ${reusedCount}개 | 실패 ${skippedCount}개`
    );
  }

  const cacheData = {
    createdAt: new Date().toISOString(),
    count: rawFeatureData.length,
    reusedCount,
    addedCount,
    skippedCount,
    stocks: rawFeatureData,
  };

  writeMarketCache(cacheData);

  return cacheData;
}

function buildFeatureDataFromCache(cacheData, events) {
  const rawFeatureData = cacheData.stocks.map((item) => ({
    ...item,
    sensitivity: eventSensitivity(
      events,
      item.volatility,
      item.marketCorrelation
    ),
  }));

  const corrValues = rawFeatureData.map((item) => item.marketCorrelation);
  const volValues = rawFeatureData.map((item) => item.volatility);
  const sensValues = rawFeatureData.map((item) => item.sensitivity);

  return rawFeatureData.map((item) => ({
    code: item.code,
    ticker: item.ticker,
    name: item.name,
    market: item.market,
    features: [
      normalizeFeature(
        item.marketCorrelation,
        Math.min(...corrValues),
        Math.max(...corrValues)
      ),
      normalizeFeature(
        item.volatility,
        Math.min(...volValues),
        Math.max(...volValues)
      ),
      normalizeFeature(
        item.sensitivity,
        Math.min(...sensValues),
        Math.max(...sensValues)
      ),
    ],
    rawMetrics: {
      marketCorrelation: Number(item.marketCorrelation.toFixed(4)),
      volatility: Number(item.volatility.toFixed(4)),
      sensitivity: Number(item.sensitivity.toFixed(4)),
    },
  }));
}

function cumulativeReturn(priceData, days = 5) {
  if (!priceData || priceData.length < days + 1) return 0;

  const recent = priceData.slice(-(days + 1));
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;

  if (!first || !last) return 0;

  return (last - first) / first;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function calculateMarketConsistencyScore(targetStock, peerStocks) {
  const ANALYSIS_DAYS = 5;

  const reactionResults = [];

  for (const stock of peerStocks) {
    try {
      const prices = await fetchYahooPrices(stock.ticker);
      const recentReturn = cumulativeReturn(prices, ANALYSIS_DAYS);

      reactionResults.push({
        ...stock,
        recentReturn,
      });
    } catch {
      reactionResults.push({
        ...stock,
        recentReturn: 0,
      });
    }
  }

  const validResults = reactionResults.filter(
    (stock) => Number.isFinite(stock.recentReturn)
  );

  if (validResults.length === 0) {
    return {
      score: 0,
      directionScore: 0,
      magnitudeScore: 0,
      clusterQualityScore: 0,
      dominantDirection: 'neutral',
      analyzedPeerCount: 0,
      averagePeerReturn: 0,
      explanation: '최근 주가 데이터를 충분히 불러오지 못해 시장 반응 일치도를 계산하지 못했습니다.',
      peerReactions: [],
    };
  }

  const positiveCount = validResults.filter((stock) => stock.recentReturn > 0).length;
  const negativeCount = validResults.filter((stock) => stock.recentReturn < 0).length;

  const dominantDirection =
    positiveCount > negativeCount
      ? 'up'
      : negativeCount > positiveCount
        ? 'down'
        : 'neutral';

  const sameDirectionCount =
    dominantDirection === 'up'
      ? positiveCount
      : dominantDirection === 'down'
        ? negativeCount
        : 0;

  const directionScore =
    dominantDirection === 'neutral'
      ? 50
      : (sameDirectionCount / validResults.length) * 100;

  const reactionStrengths = validResults.map((stock) => {
    const volatility = stock.rawMetrics?.volatility || 0.01;
    const expectedMove = volatility * Math.sqrt(ANALYSIS_DAYS);

    if (expectedMove === 0) return 0;

    return Math.abs(stock.recentReturn) / expectedMove;
  });

  const averageReactionStrength = mean(reactionStrengths);
  const magnitudeScore = Math.min(averageReactionStrength / 1.5, 1) * 100;

  const distances = validResults
    .map((stock) => stock.similarityDistance)
    .filter((distance) => Number.isFinite(distance));

  const averageDistance = distances.length > 0 ? mean(distances) : 1;
  const maxPossibleDistance = Math.sqrt(3);
  const clusterQualityScore =
    (1 - Math.min(averageDistance / maxPossibleDistance, 1)) * 100;

  const finalScore =
    directionScore * 0.45 +
    magnitudeScore * 0.35 +
    clusterQualityScore * 0.2;

  const averagePeerReturn = mean(validResults.map((stock) => stock.recentReturn));

  return {
    score: clampScore(finalScore),
    directionScore: clampScore(directionScore),
    magnitudeScore: clampScore(magnitudeScore),
    clusterQualityScore: clampScore(clusterQualityScore),
    dominantDirection,
    analyzedPeerCount: validResults.length,
    averagePeerReturn,
    explanation:
      `최근 ${ANALYSIS_DAYS}거래일 기준으로 동일 군집 종목들의 방향성, 움직임의 크기, 군집 유사도를 종합해 시장 반응 일치도를 계산했습니다.`,
    peerReactions: validResults.map((stock) => ({
      ticker: stock.ticker,
      name: stock.name,
      recentReturn: Number((stock.recentReturn * 100).toFixed(2)),
    })),
  };
}

function holdingReturn(priceData, buyDelay, holdingDays) {
  if (!priceData || priceData.length < buyDelay + holdingDays + 1) return null;

  const buyIndex = priceData.length - 1 - holdingDays - buyDelay;
  const sellIndex = buyIndex + holdingDays;

  const buyPrice = priceData[buyIndex]?.close;
  const sellPrice = priceData[sellIndex]?.close;

  if (!buyPrice || !sellPrice) return null;

  return (sellPrice - buyPrice) / buyPrice;
}

async function calculateInvestmentSignal(targetStock, peerStocks, reliabilityScore, marketConsistencyScore) {
  const HOLDING_DAYS = 20;
  const MAX_BUY_DELAY = 10;

  const stocks = [targetStock, ...peerStocks.slice(0, 10)];
  const delayResults = [];

  for (let delay = 0; delay <= MAX_BUY_DELAY; delay++) {
    const returns = [];

    for (const stock of stocks) {
      try {
        const prices = await fetchYahooPrices(stock.ticker);
        const result = holdingReturn(prices, delay, HOLDING_DAYS);

        if (result !== null && Number.isFinite(result)) {
          returns.push(result);
        }
      } catch {}
    }

    if (returns.length > 0) {

  const positiveReturns =
    returns.filter((value) => value >= 0);

  const negativeReturns =
    returns.filter((value) => value < 0);

  const upProbability =
    positiveReturns.length / returns.length;

  const downProbability =
    negativeReturns.length / returns.length;

  const averageUpReturn =
    positiveReturns.length > 0
      ? mean(positiveReturns)
      : 0;

  const averageDownReturn =
    negativeReturns.length > 0
      ? mean(negativeReturns)
      : 0;

  // 예상수익률
  const expectedReturn =
    upProbability * averageUpReturn +
    downProbability * averageDownReturn;

  const volatility =
    standardDeviation(returns);

  const riskFreeRate =
    0.03 * (HOLDING_DAYS / 252);

  // 샤프비율 형태
  const sharpeScore =
    volatility === 0
      ? -999
      : (expectedReturn - riskFreeRate) /
        volatility;

  const capitalProtection =
    upProbability * 100;

  delayResults.push({
    buyDelay: delay,
    expectedReturn,
    capitalProtection,
    sampleCount: returns.length,
    sharpeScore,
    successRate: upProbability,
  });
}
  }

  if (delayResults.length === 0) {
    throw new Error('투자 시그널 계산에 필요한 가격 데이터가 부족합니다.');
  }

  const best = delayResults.sort(
  (a, b) =>
    b.sharpeScore -
    a.sharpeScore
)[0];

  const expectedReturn =
  best.expectedReturn * 100;

  const capitalProtection =
  best.capitalProtection;

let strategy = '보류';

if (
  expectedReturn >= 8 &&
  capitalProtection >= 75
) {
  strategy = '적극매수';
} else if (
  expectedReturn >= 4 &&
  capitalProtection >= 65
) {
  strategy = '분할매수';
} else if (
  expectedReturn >= 1 &&
  capitalProtection >= 55
) {
  strategy = '소액 진입';
} else if (
  expectedReturn >= 0 &&
  capitalProtection >= 45
) {
  strategy = '관망';
} else {
  strategy = '보류';
}

  return {
    strategy,
    bestBuyDelay: best.buyDelay,
    expectedReturn: Number(expectedReturn.toFixed(2)),
    capitalProtection: Math.round(capitalProtection),
    holdingDays: HOLDING_DAYS,
    sampleCount: best.sampleCount,
    successRate: Number((best.successRate * 100).toFixed(1)),
    delayResults: delayResults.map((item) => ({
  buyDelay: item.buyDelay,
  expectedReturn:
    Number((item.expectedReturn * 100).toFixed(2)),
  capitalProtection:
    Math.round(item.capitalProtection),
  successRate:
    Number((item.successRate * 100).toFixed(1)),
  sampleCount: item.sampleCount,
})),
    explanation:
      `기준 종목과 유사 종목의 과거 가격 데이터를 이용해 0~10거래일 진입 시점을 비교하고, ${HOLDING_DAYS}거래일 보유 수익률과 양의 수익률 비율을 기준으로 최적 매수 시점을 산출했습니다.`,
  };
}

app.post('/build-market-cache', async (req, res) => {
  try {
    const cacheData = await buildMarketCache();

return res.json({
  message: '전체시장 캐시 생성 완료',
  createdAt: cacheData.createdAt,
  count: cacheData.count,
  reusedCount: cacheData.reusedCount,
  addedCount: cacheData.addedCount,
  skippedCount: cacheData.skippedCount,
});
  } catch (error) {
    console.error('build-market-cache error:', error);

    return res.status(500).json({
      error: error instanceof Error ? error.message : '캐시 생성 실패',
    });
  }
});

app.post('/cluster-analysis', async (req, res) => {
  const { headline = '', summary = '', body = '', events = [] } = req.body;

  try {
    let cacheData = readMarketCache();

    if (!cacheData) {
      return res.status(400).json({
        error: '시장 캐시가 없습니다. 먼저 전체시장 캐시를 생성해 주세요.',
      });
    }

    const universe = cacheData.stocks;
    const text = `${headline} ${summary} ${body}`;
    const targetInfo = inferTargetTickerFromUniverse(text, universe, events);
const targetTicker = targetInfo.ticker;

    const featureData = buildFeatureDataFromCache(cacheData, events);
    const CLUSTER_COUNT = 15;
    const clusteredStocks = simpleKMeans(featureData, CLUSTER_COUNT);

    const targetStock =
      clusteredStocks.find((stock) => stock.ticker === targetTicker) ||
      clusteredStocks[0];

const peerStocks = clusteredStocks
  .filter(
    (stock) =>
      stock.cluster === targetStock.cluster &&
      stock.ticker !== targetStock.ticker
  )
  .map((stock) => ({
    ...stock,
    similarityDistance: euclideanDistance(stock.features, targetStock.features),
  }))
  .sort((a, b) => a.similarityDistance - b.similarityDistance)
  .slice(0, 20);

const marketConsistency = await calculateMarketConsistencyScore(
      targetStock,
      peerStocks
    );

    return res.json({
      targetStock,
      peerStocks,
      marketConsistency,
      targetSelectionReason: targetInfo.reason,
      targetSelectionType: targetInfo.type,
      clusteredStocks: clusteredStocks.slice(0, 200),
      totalAnalyzedStocks: clusteredStocks.length,
      clusterCount: CLUSTER_COUNT,
      similarStockCount: peerStocks.length,
      cacheCreatedAt: cacheData.createdAt,
      explanation: eventImpactMessage(events),
      features: [
        'KOSPI200 수익률 상관계수',
        '일별 수익률 변동성',
        '이벤트 민감도',
      ],
    });
  } catch (error) {
    console.error('cluster-analysis error:', error);

    return res.status(500).json({
      error: '캐시 기반 전체시장 군집주 분석에 실패했습니다.',
    });
  }
});

app.post('/investment-signal', async (req, res) => {
  const {
    targetStock,
    peerStocks = [],
    reliabilityScore = 0,
    marketConsistencyScore = 0,
  } = req.body;

  try {
    if (!targetStock?.ticker) {
      return res.status(400).json({
        error: '기준 종목 정보가 없습니다.',
      });
    }

    const signal = await calculateInvestmentSignal(
      targetStock,
      peerStocks,
      Number(reliabilityScore),
      Number(marketConsistencyScore)
    );

    return res.json(signal);
  } catch (error) {
    console.error('investment-signal error:', error);

    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : '투자 시그널 계산에 실패했습니다.',
    });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});