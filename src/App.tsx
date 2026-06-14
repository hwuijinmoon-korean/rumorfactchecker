import { useMemo, useState } from 'react';

type InputMode = 'url' | 'text';

interface ExtractedArticle {
  headline: string;
  summary: string;
  body: string;
  publisher: string;
  author: string;
}

type PageMode =
  | 'input'
  | 'event'
  | 'cluster'
  | 'market'
  | 'confidence'
  | 'save'
  | 'investmentQuestion'
  | 'investmentLoading'
  | 'investmentOpinion';

interface ClusterStock {
  ticker: string;
  name: string;
  market?: string;
  features: number[];
  cluster: number;
  rawMetrics?: {
    marketCorrelation: number;
    volatility: number;
    sensitivity: number;
  };
}

interface MarketConsistencyResult {
  score: number;
  directionScore: number;
  magnitudeScore: number;
  clusterQualityScore: number;
  dominantDirection: 'up' | 'down' | 'neutral';
  analyzedPeerCount: number;
  averagePeerReturn: number;
  explanation: string;
}

interface ClusterAnalysisResult {
  targetStock: ClusterStock;
  peerStocks: ClusterStock[];
  clusteredStocks: ClusterStock[];
  explanation: string;
  features: string[];
  totalAnalyzedStocks?: number;
  cacheCreatedAt?: string;
  targetSelectionReason?: string;
  marketConsistency?: MarketConsistencyResult;
}

interface InvestmentSignalResult {
  strategy: string;
  bestBuyDelay: number;
  expectedReturn: number;
  capitalProtection: number;
  holdingDays: number;
  sampleCount: number;
  successRate: number;
  explanation: string;
}

const extractEvents = (text: string): string[] => {
  const normalizedText = text.toLowerCase();

  const keywords = {
    전쟁: ['전쟁', '충돌', '공습', '침공', '미사일', '군사'],
    금리: ['금리', '기준금리', '연준', 'fomc'],
    유가: ['유가', '원유', 'wti', 'opec', '브렌트유'],
    환율: ['환율', '달러', '엔화', '원화'],
    인플레이션: ['인플레이션', 'cpi', '물가', '스태그플레이션'],
    경기: ['경기 침체', '리세션', 'gdp', '호황', '불황', '경기 성장'],
    기업실적: ['실적', '영업이익', '매출', '손익분기', '시가총액'],
    정책: ['정책', '규제', '법안'],
    산업: ['반도체', 'ai', '전기차'],
    금융시장: ['증시', '주가', '급락', '급등'],
    신용리스크: ['부도', '파산', '디폴트'],
    원자재: ['국제 금값', '금 가격', '국제 은값', '은 가격', '구리', '천연가스', '니켈', '리튬', '알루미늄', '원자재'],
  };

  const detected: string[] = [];

  Object.entries(keywords).forEach(([event, words]) => {
    for (const word of words) {
      if (normalizedText.includes(word)) {
        detected.push(event);
        break;
      }
    }
  });

  return detected;
};

const clampScore = (value: number) => {
  return Math.max(0, Math.min(100, Math.round(value)));
};

const getSourceTypeScore = (publisher: string) => {
  const text = publisher.toLowerCase();

  if (
    publisher.includes('금융감독원') ||
    publisher.includes('한국은행') ||
    publisher.includes('기획재정부') ||
    publisher.includes('거래소') ||
    publisher.includes('공시')
  ) {
    return 40;
  }

  if (
    publisher.includes('연합뉴스') ||
    publisher.includes('로이터') ||
    publisher.includes('블룸버그')
  ) {
    return 35;
  }

  if (
    publisher.includes('한국경제') ||
    publisher.includes('매일경제') ||
    publisher.includes('서울경제') ||
    publisher.includes('이데일리') ||
    publisher.includes('머니투데이') ||
    publisher.includes('조선비즈')
  ) {
    return 30;
  }

  if (
    text.includes('blog') ||
    publisher.includes('블로그') ||
    publisher.includes('커뮤니티')
  ) {
    return 10;
  }

  return publisher.trim() ? 25 : 0;
};

const getAuthorClarityScore = (
  author: string,
  publisher: string,
  url: string,
  text: string
) => {
  let score = 0;

  if (author.trim()) score += 8;
  if (publisher.trim()) score += 5;
  if (url.trim()) score += 5;
  if (text.trim()) score += 2;

  return Math.min(score, 20);
};

const getEvidenceSourceScore = (text: string) => {
  const evidenceKeywords = [
    '공시',
    '자료',
    '보고서',
    '인터뷰',
    '발표',
    '통계',
    '데이터',
    '금융감독원',
    '한국은행',
    '거래소',
    '컨퍼런스콜',
    '실적발표',
    '증권신고서',
  ];

  const count = evidenceKeywords.filter((word) => text.includes(word)).length;

  if (count >= 4) return 20;
  if (count >= 2) return 15;
  if (count >= 1) return 10;
  return 5;
};

const getVerifiabilityScore = (text: string, url: string) => {
  let score = 0;

  if (url.trim()) score += 8;
  if (text.includes('http') || text.includes('www')) score += 4;

  if (
    text.includes('공시') ||
    text.includes('원문') ||
    text.includes('자료') ||
    text.includes('보고서')
  ) {
    score += 5;
  }

  if (!text.includes('출처 불명') && !text.includes('확인 불가')) {
    score += 3;
  }

  return Math.min(score, 20);
};

const getSourceScore = (
  publisher: string,
  author: string,
  url: string,
  text: string
) => {
  const sourceTypeScore = getSourceTypeScore(publisher);
  const authorClarityScore = getAuthorClarityScore(author, publisher, url, text);
  const evidenceSourceScore = getEvidenceSourceScore(text);
  const verifiabilityScore = getVerifiabilityScore(text, url);

  return {
    total: clampScore(
      sourceTypeScore +
        authorClarityScore +
        evidenceSourceScore +
        verifiabilityScore
    ),
    sourceTypeScore,
    authorClarityScore,
    evidenceSourceScore,
    verifiabilityScore,
  };
};

const getEventClarityScore = (events: string[]) => {
  if (events.length === 0) return 10;
  if (events.length === 1) return 22;
  if (events.length <= 3) return 28;
  return 30;
};

const getEconomicLogicScore = (text: string, events: string[]) => {
  const logicKeywords = [
    '상승',
    '하락',
    '급등',
    '급락',
    '영향',
    '전망',
    '수혜',
    '악재',
    '호재',
    '부담',
    '둔화',
    '개선',
    '증가',
    '감소',
  ];

  const logicCount = logicKeywords.filter((word) => text.includes(word)).length;

  if (events.length > 0 && logicCount >= 4) return 40;
  if (events.length > 0 && logicCount >= 2) return 32;
  if (events.length > 0 && logicCount >= 1) return 25;
  if (events.length > 0) return 18;
  return 10;
};

const getExaggerationScore = (text: string) => {
  const exaggerationKeywords = [
    '무조건',
    '반드시',
    '확실히',
    '폭등',
    '폭락',
    '대박',
    '몰빵',
    '100%',
    '절대',
  ];

  const count = exaggerationKeywords.filter((word) => text.includes(word)).length;

  if (count === 0) return 30;
  if (count === 1) return 24;
  if (count === 2) return 18;
  return 10;
};

const getContentScore = (text: string, events: string[]) => {
  const eventClarityScore = getEventClarityScore(events);
  const economicLogicScore = getEconomicLogicScore(text, events);
  const exaggerationScore = getExaggerationScore(text);

  return {
    total: clampScore(
      eventClarityScore +
        economicLogicScore +
        exaggerationScore
    ),
    eventClarityScore,
    economicLogicScore,
    exaggerationScore,
  };
};

const getSameEventReportScore = (publisher: string, text: string) => {
  const mediaKeywords = [
    '연합뉴스',
    '로이터',
    '블룸버그',
    '한국경제',
    '매일경제',
    '이데일리',
    '서울경제',
    '머니투데이',
  ];

  const count = mediaKeywords.filter(
    (word) => publisher.includes(word) || text.includes(word)
  ).length;

  if (count >= 3) return 20;
  if (count >= 2) return 15;
  if (count >= 1) return 10;
  return 5;
};

const getIndependentSourceScore = (text: string) => {
  const independentKeywords = [
    '정부',
    '공시',
    '한국은행',
    '금융감독원',
    '거래소',
    '기업',
    '증권사',
    '연구원',
    '전문가',
    '로이터',
    '블룸버그',
  ];

  const count = independentKeywords.filter((word) => text.includes(word)).length;

  if (count >= 4) return 25;
  if (count >= 3) return 20;
  if (count >= 2) return 15;
  if (count >= 1) return 10;
  return 5;
};

const getCoreFactScore = (marketConsistencyScore: number) => {
  return Math.min(35, Math.round(marketConsistencyScore * 0.35));
};

const getRefutationScore = (text: string) => {
  const refutationKeywords = [
    '정정',
    '반박',
    '사실무근',
    '부인',
    '오보',
    '허위',
    '루머',
  ];

  const hasRefutation = refutationKeywords.some((word) => text.includes(word));

  return hasRefutation ? 5 : 20;
};

const getCrossScore = (
  text: string,
  publisher: string,
  marketConsistencyScore: number
) => {
  const sameEventReportScore = getSameEventReportScore(publisher, text);
  const independentSourceScore = getIndependentSourceScore(text);
  const coreFactScore = getCoreFactScore(marketConsistencyScore);
  const refutationScore = getRefutationScore(text);

  return {
    total: clampScore(
      sameEventReportScore +
        independentSourceScore +
        coreFactScore +
        refutationScore
    ),
    sameEventReportScore,
    independentSourceScore,
    coreFactScore,
    refutationScore,
  };
};

const getReliabilityGrade = (score: number) => {
  if (score >= 80) return '높음';
  if (score >= 60) return '보통';
  return '낮음';
};

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>('url');

  const [url, setUrl] = useState('');
  
  const [pageMode, setPageMode] = useState<PageMode>('input');

  const [headline, setHeadline] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [publisher, setPublisher] = useState('');
  const [author, setAuthor] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showExtractedFields, setShowExtractedFields] = useState(false);

const [clusterLoading, setClusterLoading] = useState(false);
const [clusterResult, setClusterResult] = useState<ClusterAnalysisResult | null>(null);
const [investmentLoading, setInvestmentLoading] = useState(false);
const [investmentSignal, setInvestmentSignal] =
  useState<InvestmentSignalResult | null>(null); 
const [cacheLoading, setCacheLoading] = useState(false);

  const resetArticleFields = () => {
    setHeadline('');
    setSummary('');
    setBody('');
    setPublisher('');
    setAuthor('');
  };

  const handleModeChange = (mode: InputMode) => {
    setInputMode(mode);
    setMessage('');

    if (mode === 'url') {
      resetArticleFields();
      setShowExtractedFields(false);
    } else {
      setShowExtractedFields(true);
    }
  };

  const handleExtractFromUrl = async () => {
  if (!url.trim()) return;

  try {
    setLoading(true);
    setMessage('');
    setShowExtractedFields(false);
    resetArticleFields();

    console.log('requesting:', url);

    const response = await fetch('/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    console.log('response status:', response.status);

    const raw = await response.text();
    console.log('raw response:', raw);

    const data = JSON.parse(raw);

    if (!response.ok || data.error) {
      throw new Error(data.error || '기사 추출 실패');
    }

    setHeadline(data.headline || '');
    setSummary(data.summary || '');
    setBody(data.body || '');
    setPublisher(data.publisher || '');
    setAuthor(data.author || '');
    setShowExtractedFields(true);
    setMessage('기사 내용을 불러왔습니다. 추출 결과를 확인해 주세요.');
  } catch (error) {
    console.error('extract error:', error);

    if (error instanceof TypeError) {
      setMessage('서버 연결에 실패했습니다. server.mjs 실행 여부를 확인해 주세요.');
    } else {
      setMessage(
        error instanceof Error
          ? error.message
          : '기사 내용을 불러오지 못했습니다.'
      );
    }

    setShowExtractedFields(false);
  } finally {
    setLoading(false);
  }
};

  const handleSubmit = () => {
    alert(
      `헤드라인: ${headline}\n\n리드/요약: ${summary}\n\n본문 길이: ${body.length}자\n\n출처: ${publisher}${
        author ? ` / ${author}` : ''
      }`
    );
  };

  const isDisabled =
    headline.trim() === '' ||
    body.trim() === '' ||
    publisher.trim() === '';

  const eventSourceText = `${headline}\n${summary}\n${body}`;
  const detectedEvents = useMemo(() => extractEvents(eventSourceText), [eventSourceText]);
  const finalReliability = useMemo(() => {
  const sourceScore = getSourceScore(
    publisher,
    author,
    url,
    eventSourceText
  );

  const contentScore = getContentScore(
    eventSourceText,
    detectedEvents
  );

  const marketConsistencyScore =
    clusterResult?.marketConsistency?.score ?? 0;

  const crossScore = getCrossScore(
    eventSourceText,
    publisher,
    marketConsistencyScore
  );

  const finalScore = clampScore(
    sourceScore.total * 0.3 +
      contentScore.total * 0.3 +
      crossScore.total * 0.4
  );

  return {
    finalScore,
    grade: getReliabilityGrade(finalScore),
    sourceScore,
    contentScore,
    crossScore,
    marketConsistencyScore,
  };
}, [publisher, author, url, eventSourceText, detectedEvents, clusterResult]);
  const handleNextStep = () => {
  setPageMode('event');
};

  const handleBackToInput = () => {
  setPageMode('input');
};

const handleBuildMarketCache = async () => {
  try {
    setCacheLoading(true);
    setMessage('');

    const response = await fetch('/build-market-cache', {
      method: 'POST',
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || '전체시장 캐시 생성 실패');
    }

    setMessage(
  `전체시장 캐시 생성 완료: 총 ${data.count}개 종목 / 기존 캐시 재사용 ${data.reusedCount}개 / 신규 추가 ${data.addedCount}개 / 제외 ${data.skippedCount}개`
);
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : '캐시 생성 중 오류 발생'
    );
  } finally {
    setCacheLoading(false);
  }
};

const handleClusterAnalysis = async () => {
  try {
    setClusterLoading(true);
    setMessage('');

    const response = await fetch('/cluster-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline,
        summary,
        body,
        publisher,
        author,
        events: detectedEvents,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || '군집주 분석 실패');
    }

    setClusterResult(data);
    setPageMode('cluster');
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '군집주 분석 중 오류 발생');
  } finally {
    setClusterLoading(false);
  }
};

const handleInvestmentSignal = async () => {
  if (!clusterResult) return;

  try {
    setInvestmentLoading(true);
    setMessage('');
    setPageMode('investmentLoading');

    const response = await fetch('/investment-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetStock: clusterResult.targetStock,
        peerStocks: clusterResult.peerStocks,
        reliabilityScore: finalReliability.finalScore,
        marketConsistencyScore: clusterResult.marketConsistency?.score || 0,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || '투자 시그널 계산 실패');
    }

    setInvestmentSignal(data);
    setPageMode('investmentOpinion');
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : '투자 시그널 계산 중 오류가 발생했습니다.'
    );
  } finally {
    setInvestmentLoading(false);
  }
};

const handleBackToEvent = () => {
  setPageMode('event');
};

if (pageMode === 'event') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button className="back-button" onClick={handleBackToInput} type="button">
              ← 이전으로
            </button>

            <h1 className="title">이벤트 탐지 결과</h1>
            <p className="subtitle">
              추출된 기사 텍스트를 바탕으로 주가에 영향을 줄 수 있는 이벤트를 탐지했습니다.
            </p>

            <div className="result-card">
              <div className="result-label">헤드라인</div>
              <div className="result-text">{headline || '없음'}</div>
            </div>

            <div className="result-card">
              <div className="result-label">출처</div>
              <div className="result-text">
                {publisher}
                {author ? ` / ${author}` : ''}
              </div>
            </div>

            <div className="result-card">
              <div className="result-label">탐지된 이벤트</div>
              {detectedEvents.length > 0 ? (
                <div className="event-list">
                  {detectedEvents.map((event) => (
                    <span key={event} className="event-chip">
                      {event}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="result-text">탐지된 이벤트가 없습니다.</div>
              )}
            </div>

            <div className="result-card">
              <div className="result-label">분석 대상 텍스트</div>
              <div className="article-preview">{eventSourceText || '텍스트가 없습니다.'}</div>
            </div>
          </div>

<div className="bottom-action">
  <button
    className="secondary-button"
    onClick={handleBuildMarketCache}
    disabled={cacheLoading}
    type="button"
  >
    {cacheLoading ? '전체시장 캐시 생성 중...' : '전체시장 캐시 생성'}
  </button>

  <button
    className="submit-button"
    onClick={handleClusterAnalysis}
    disabled={clusterLoading}
    type="button"
  >
    {clusterLoading ? '군집주 분석 중...' : '군집주 분석 실행'}
  </button>
</div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'cluster') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button className="back-button" onClick={() => setPageMode('event')} type="button">
              ← 이벤트 결과로
            </button>

            <h1 className="title">군집주 분석 결과</h1>
            <p className="subtitle">
              전체시장 주가 데이터를 기반으로 K-means 군집 분석을 수행했습니다.
            </p>

            {clusterResult?.targetStock ? (
  <>
                <div className="result-card">
                  <div className="result-label">전체시장 분석 정보</div>
                  <div className="result-text">
                    분석 종목 수: {clusterResult.totalAnalyzedStocks ?? '-'}개
                    <br />
                    캐시 생성 시각: {clusterResult.cacheCreatedAt ?? '-'}
                  </div>
                </div>

                <div className="result-card">
                  <div className="result-label">기준 종목</div>
                  <div className="result-text">
                    {clusterResult.targetStock.name} ({clusterResult.targetStock.ticker})
                  </div>

                  {clusterResult.targetSelectionReason && (
                    <div className="result-text">
                     기준 종목 선정 방식: {clusterResult.targetSelectionReason}
                    </div>
                  )}
                </div>

                <div className="result-card">
                  <div className="result-label">이벤트 해석</div>
                  <div className="result-text">{clusterResult.explanation}</div>
                </div>

                <div className="result-card">
                  <div className="result-label">동일 군집 내 유사 종목 TOP 20 </div>
                  <div className="cluster-list">
                    {clusterResult.peerStocks.map((stock) => (
                      <div key={stock.ticker} className="cluster-item">
                        <strong>{stock.name}</strong>
                        <span>{stock.ticker} / {stock.market}</span>
                        <small>Cluster {stock.cluster + 1}</small>

                        {stock.rawMetrics && (
                          <div className="metric-box">
                            <span>시장상관도: {stock.rawMetrics.marketCorrelation}</span>
                            <span>변동성: {stock.rawMetrics.volatility}</span>
                            <span>이벤트민감도: {stock.rawMetrics.sensitivity}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
  </>
) : (
  <div className="result-card">
    <div className="result-label">분석 오류</div>
    <div className="result-text">
      분석 가능한 종목 데이터가 없습니다. krx_stocks.csv와 market-cache.json을 다시 확인해 주세요.
    </div>
  </div>
)} 
          </div>

         <div className="bottom-action">
  <button
    className="submit-button"
    onClick={() => setPageMode('market')}
    disabled={!clusterResult}
    type="button"
  >
    시장 반응 일치도 확인하기
  </button>

  <button
    className="secondary-button"
    onClick={() => setPageMode('event')}
    type="button"
  >
    다시 분석하기
  </button>
</div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'market') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button
              className="back-button"
              onClick={() => setPageMode('cluster')}
              type="button"
            >
              ← 군집주 분석 결과로
            </button>

            <h1 className="title">시장 반응 일치도</h1>

            <p className="subtitle">
              동일 군집 내 유사 종목 TOP 20의 최근 움직임을 기반으로
              뉴스 이벤트와 실제 시장 반응의 일치도를 계산했습니다.
            </p>

            {clusterResult?.marketConsistency ? (
              <>
                <div className="result-card">
                  <div className="result-label">
                    최종 시장 반응 일치도 점수
                  </div>

                  <div className="result-text">
                    <strong>
                      {clusterResult.marketConsistency.score}점
                    </strong>
                  </div>
                </div>

                <div className="result-card">
                  <div className="result-label">세부 점수</div>

                  <div className="result-text">
                    방향성 점수:
                    {' '}
                    {clusterResult.marketConsistency.directionScore}점
                    <br />

                    반응 강도 점수:
                    {' '}
                    {clusterResult.marketConsistency.magnitudeScore}점
                    <br />

                    군집 품질 점수:
                    {' '}
                    {clusterResult.marketConsistency.clusterQualityScore}점
                    <br />

                    분석 종목 수:
                    {' '}
                    {clusterResult.marketConsistency.analyzedPeerCount}개
                    <br />

                    평균 최근 수익률:
                    {' '}
                    {(
                      clusterResult.marketConsistency.averagePeerReturn * 100
                    ).toFixed(2)}
                    %
                    <br />

                    우세 방향:
                    {' '}
                    {clusterResult.marketConsistency.dominantDirection === 'up'
                      ? '상승'
                      : clusterResult.marketConsistency.dominantDirection === 'down'
                        ? '하락'
                        : '중립'}
                  </div>
                </div>

                <div className="result-card">
                  <div className="result-label">해석</div>

                  <div className="result-text">
                    {clusterResult.marketConsistency.explanation}
                  </div>
                </div>
              </>
            ) : (
              <div className="result-card">
                <div className="result-label">계산 결과 없음</div>

                <div className="result-text">
                  시장 반응 일치도 점수가 아직 계산되지 않았습니다.
                </div>
              </div>
            )}
          </div>

          <div className="bottom-action">
            <button
  className="submit-button"
  onClick={() => setPageMode('confidence')}
  type="button"
>
  최종 신뢰도 점수 확인하기
</button>
          </div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'confidence') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button
              className="back-button"
              onClick={() => setPageMode('market')}
              type="button"
            >
              ← 시장 반응 일치도로
            </button>

            <h1 className="title">최종 신뢰도 점수</h1>
            <p className="subtitle">
              기사 출처, 이벤트 탐지 결과, 기준 종목 선정 방식, 시장 반응 일치도를 종합해 최종 신뢰도를 계산했습니다.
            </p>

            <div className="result-card reliability-card">

  <div
    className="reliability-circle"
    style={{
      background: `conic-gradient(
        #ef4444 0% ${finalReliability.finalScore}%,
        #d1d5db ${finalReliability.finalScore}% 100%
      )`,
    }}
  >
    <div className="reliability-inner">
      {finalReliability.finalScore}%
    </div>
  </div>

  <div className="reliability-message">
    해당 루머의 신뢰도는 {finalReliability.finalScore}% 입니다.
  </div>

</div>

            <div className="result-card">
              <div className="result-label">세부 산정 기준</div>
              <div className="result-text">
            <div className="score-section-title">
  출처 신뢰도: {finalReliability.sourceScore.total}점
</div>

<div className="score-table">
  <div className="score-row score-header">
    <span>평가항목</span>
    <span>설명</span>
    <span>배점</span>
  </div>

  <div className="score-row">
    <span>출처 유형</span>
    <span>공식기관·주요 언론사 여부</span>
    <strong>{finalReliability.sourceScore.sourceTypeScore} / 40</strong>
  </div>

  <div className="score-row">
    <span>작성자/출처 명확성</span>
    <span>기자명·언론사·URL 확인 여부</span>
    <strong>{finalReliability.sourceScore.authorClarityScore} / 20</strong>
  </div>

  <div className="score-row">
    <span>근거 자료 언급</span>
    <span>공시·보고서·통계 등 근거 제시 여부</span>
    <strong>{finalReliability.sourceScore.evidenceSourceScore} / 20</strong>
  </div>

  <div className="score-row">
    <span>검증 가능성</span>
    <span>원문·자료·출처 추적 가능 여부</span>
    <strong>{finalReliability.sourceScore.verifiabilityScore} / 20</strong>
  </div>
</div>
                <br />
                <br />
              <div className="score-section-title">
  기사 내용 신뢰도: {finalReliability.contentScore.total}점
</div>

<div className="score-table">
  <div className="score-row score-header">
    <span>평가항목</span>
    <span>설명</span>
    <span>배점</span>
  </div>

  <div className="score-row">
    <span>이벤트 명확성</span>
    <span>전쟁·금리·유가 등 핵심 이벤트 식별 여부</span>
    <strong>{finalReliability.contentScore.eventClarityScore} / 30</strong>
  </div>

  <div className="score-row">
    <span>경제적 논리성</span>
    <span>이벤트와 시장 영향의 연결성</span>
    <strong>{finalReliability.contentScore.economicLogicScore} / 40</strong>
  </div>

  <div className="score-row">
    <span>과장 표현 안정성</span>
    <span>확정적·자극적 표현이 적은지</span>
    <strong>{finalReliability.contentScore.exaggerationScore} / 30</strong>
  </div>
</div>
                <br />
                <br />
                <div className="score-section-title">
  교차 검증 신뢰도: {finalReliability.crossScore.total}점
</div>
<div className="score-table">
  <div className="score-row score-header">
    <span>평가항목</span>
    <span>설명</span>
    <span>배점</span>
  </div>

  <div className="score-row">
    <span>동일 사건 보도</span>
    <span>여러 매체에서 같은 사건을 보도했는지</span>
    <strong>{finalReliability.crossScore.sameEventReportScore} / 20</strong>
  </div>

  <div className="score-row">
    <span>독립 출처 언급</span>
    <span>정부·공시·전문가 등 독립 출처가 있는지</span>
    <strong>{finalReliability.crossScore.independentSourceScore} / 25</strong>
  </div>

  <div className="score-row highlight-row">
    <span>시장 반응 반영</span>
    <span>
      시장 반응 일치도 {finalReliability.marketConsistencyScore}점 × 0.35
    </span>
    <strong>{finalReliability.crossScore.coreFactScore} / 35</strong>
  </div>

  <div className="score-row">
    <span>반박/정정 여부</span>
    <span>반박·정정·오보 표현이 있는지</span>
    <strong>{finalReliability.crossScore.refutationScore} / 20</strong>
  </div>
</div>
                <br />               
              </div>
            </div>

            <div className="result-card">
              <div className="result-label">가중치</div>
              <div className="result-text">
                최종 신뢰도 = 출처 신뢰도 30% + 기사 내용 신뢰도 30% + 교차 검증 신뢰도 40%
              </div>
            </div>

            <div className="result-card">
              <div className="result-label">해석</div>
              <div className="result-text">
                교차 검증 신뢰도에는 동일 사건 보도, 독립 출처, 반박 여부, 시장 반응 일치도가 함께 반영됩니다.
                점수가 높을수록 기사 내용과 실제 시장 데이터가 더 일관되게 움직였다는 의미입니다.
              </div>
            </div>
          </div>

          <div className="bottom-action">
            <button
              className="submit-button"
              onClick={() => setPageMode('save')}
              type="button"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'save') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button className="back-button" onClick={() => setPageMode('confidence')} type="button">
              ← 신뢰도 결과로
            </button>

            <div className="confirm-panel">
              이 뉴스를 
              <br />
              저장하시겠습니까?
            </div>
          </div>

          <div className="choice-actions">
            <button className="icon-choice" onClick={() => setPageMode('investmentQuestion')} type="button">
              <span>O</span>
              저장
            </button>
            <button className="icon-choice" onClick={() => setPageMode('investmentQuestion')} type="button">
              <span>X</span>
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'investmentQuestion') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button className="back-button" onClick={() => setPageMode('save')} type="button">
              ← 저장 선택으로
            </button>

            <div className="confirm-panel">
              투자 의견을
              <br />
              제공받으시겠습니까?
            </div>

            {message && <p className="message">{message}</p>}
          </div>

          <div className="choice-actions">
            <button
              className="icon-choice"
              onClick={handleInvestmentSignal}
              disabled={investmentLoading}
              type="button"
            >
              <span>O</span>
              {investmentLoading ? '계산중' : '예'}
            </button>

            <button className="icon-choice" onClick={() => setPageMode('input')} type="button">
              <span>X</span>
              아니오
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'investmentLoading') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll loading-pipeline-screen">
            <h1 className="title center-title">투자 의견 생성 중</h1>

            <div className="loading-pipeline-card">
              <div className="loading-spinner" />

              <div className="pipeline-list">
                <div className="pipeline-item done">✔ 이벤트 추출 완료</div>
                <div className="pipeline-item done">✔ 군집주 분석 완료</div>
                <div className="pipeline-item done">✔ 시장 반응 검증 완료</div>
                <div className="pipeline-item active">⏳ 투자 시그널 생성 중...</div>
              </div>

              <p className="pipeline-description">
                과거 유사 종목의 수익률 데이터를 기반으로
                <br />
                최적 매수 타이밍과 예상 수익률을
                <br />
                계산하고 있습니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

if (pageMode === 'investmentOpinion') {
  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <button
              className="back-button"
              onClick={() => setPageMode('investmentQuestion')}
              type="button"
            >
              ← 투자 의견 선택으로
            </button>

            <h1 className="title center-title">투자 시그널 엔진</h1>

            {investmentSignal ? (
              <>
                <div className="signal-summary-card">
                  <div className="signal-badge">투자<br />의견</div>
                  <div>
                    <strong>{investmentSignal.strategy}</strong>
                    <p>{investmentSignal.explanation}</p>
                  </div>
                </div>

                <div className="strategy-label">최적 매수 타이밍</div>

                <div className="strategy-card">
                  <div className="buy-timing">
                    지금부터 <strong>{investmentSignal.bestBuyDelay}</strong> 거래일 후
                  </div>

                  <div className="protection-label">
                    원금 보존 가능성 {investmentSignal.capitalProtection}%
                  </div>

                  <div className="protection-bar">
                    <div
                      className="protection-fill"
                      style={{ width: `${investmentSignal.capitalProtection}%` }}
                    />
                    <div
                      className="protection-marker"
                      style={{ left: `${investmentSignal.capitalProtection}%` }}
                    />
                  </div>

                  <div className="expected-return">
                    예상 수익률 {investmentSignal.expectedReturn}%
                  </div>

                  <p className="result-text">
                    {investmentSignal.holdingDays}거래일 보유 기준, 유사 종목 {investmentSignal.sampleCount}개 샘플을 분석했습니다.
                    과거 양의 수익률 비율은 {investmentSignal.successRate}%입니다.
                  </p>
                </div>
              </>
            ) : (
              <div className="result-card">
                <div className="result-label">투자 시그널 없음</div>
                <div className="result-text">
                  투자 시그널 계산 결과가 없습니다.
                </div>
              </div>
            )}

          <div className="bottom-action">

  <button
    className="submit-button"
    onClick={() =>
      window.open(
        'https://www.samsungpop.com',
        '_blank'
      )
    }
    type="button"
  >
    내 계좌 바로가기
  </button>

  <button
    className="secondary-button"
    onClick={() => {
  setPageMode('input');

  setUrl('');
  setHeadline('');
  setSummary('');
  setBody('');
  setPublisher('');
  setAuthor('');

  setInvestmentSignal(null);
  setClusterResult(null);
  setMessage('');
}}
    type="button"
  >
    다른 뉴스 검증하기
  </button>

</div>  
          </div>
        </div>
      </div>
    </div>
  );
}

  return (
    <div className="app">
      <div className="phone-frame">
        <div className="screen">
          <div className="content-scroll">
            <h1 className="title">Finance News Fact Checker</h1>
            <p className="subtitle">뉴스 링크 또는 텍스트를 입력해 주세요.</p>

            <div className="toggle">
              <button
                className={inputMode === 'url' ? 'active' : ''}
                onClick={() => handleModeChange('url')}
                type="button"
              >
                URL 입력
              </button>
              <button
                className={inputMode === 'text' ? 'active' : ''}
                onClick={() => handleModeChange('text')}
                type="button"
              >
                텍스트 입력
              </button>
            </div>

            {inputMode === 'url' && (
              <div className="form-section">
                <label>뉴스 링크</label>
                <input
                  type="text"
                  placeholder="https://news.example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button
                  className="extract-button"
                  onClick={handleExtractFromUrl}
                  disabled={!url.trim() || loading}
                  type="button"
                >
                  {loading ? '불러오는 중...' : '기사 불러오기'}
                </button>
              </div>
            )}

            {inputMode === 'text' && (
              <div className="form-section">
                <label>헤드라인</label>
                <input
                  type="text"
                  placeholder="헤드라인을 입력하세요"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />

                <label>기사 본문</label>
                <textarea
                  className="body-box"
                  placeholder="기사 본문을 입력하세요"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />

                <label>출처(언론사)</label>
                <input
                  type="text"
                  placeholder="언론사를 입력하세요"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                />

                <label>기자명</label>
                <input
                  type="text"
                  placeholder="기자명을 입력하세요"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
            )}

            {inputMode === 'url' && showExtractedFields && (
              <div className="form-section extracted-section">
                <label>헤드라인</label>
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />

                <label>기사 본문</label>
                <textarea
                  className="body-box"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />

                <label>출처(언론사)</label>
                <input
                  type="text"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                />

                <label>기자명</label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
            )}

            {message && <p className="message">{message}</p>}
          </div>

          <div className="bottom-action">
            <button
              className="submit-button"
              onClick={handleNextStep}
              disabled={isDisabled}
              type="button"
            >
            다음 단계로
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
