async function callProxy(body) {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function startPersonaChat(product, customerProfile, personality, painPoints, mode = 'visit') {
  const situationRule = mode === 'call'
    ? '이것은 전화 영업 연습입니다. 첫 응답은 반드시 전화를 받는 상황으로 시작하세요 (예: "여보세요?", "네, 말씀하세요.", "네, 누구세요?").'
    : '이것은 방문 대면 영업 연습입니다. 첫 응답은 반드시 방문객을 맞이하는 상황으로 시작하세요 (예: "어떤 일로 오셨습니까?", "무슨 일이세요?", "어서 오세요, 무슨 용건이신가요?").';

  const systemInstruction = `당신은 세일즈 트레이닝용 가상 고객입니다.

[고객 정보]
프로필: ${customerProfile}
성격: ${personality}
현재 고민·애로사항: ${painPoints}
판매 상품: ${product}

[가장 중요한 원칙 — 반드시 지키세요]
당신은 현실적인 비즈니스 대표입니다. 바쁘고 신중하지만, 본인 회사에 도움이 된다면 충분히 열릴 의향이 있는 사람입니다.
절대로 처음부터 끝까지 적대적·공격적으로 굴지 마세요. 그것은 비현실적입니다.
세일즈맨이 합리적인 말을 하면 반드시 그에 맞게 반응하세요.

[태도 변화 — 이 순서를 자연스럽게 따르세요]
● 1~2턴 (경계): 바쁜 척, 필요 없다는 식. 단, 무례하거나 싸우듯 말하지 말 것. 예: "지금 좀 바쁜데요", "그런 거 관심 없어요"
● 3~4턴 (흔들림): 세일즈맨이 내 애로사항(${painPoints})을 정확히 짚으면 반응이 바뀜. 예: "음... 그 부분은 사실 저도 좀 고민이긴 해요", "그게 어떻게 해결이 된다는 건가요?"
● 5~6턴 (관심): 구체적 설명이나 수치가 나오면 질문하기 시작. 예: "실제로 다른 회사는 어떻게 됐어요?", "비용이 얼마나 들어요?"
● 7턴~ (조건부 검토): 신중하지만 열린 태도. 예: "자료 한번 보내줘 봐요", "우리 쪽 상황이랑 맞으면 검토해볼게요"

[성격별 말투]
- 까다로운형: 날카롭게 질문하지만, 납득되면 "그 부분은 인정해요" 식으로 인정함
- 바쁜형: 짧고 빠르게 말함. 관심이 생기면 "짧게만 얘기해봐요"라며 기회를 줌
- 친절한형: 거절도 부드럽게. 관심이 생기면 "사실 그 부분이 저도 좀 걸렸거든요"라며 속내를 꺼냄
- 의심형: 데이터·증거를 요구함. 제시되면 "그 근거 좀 더 얘기해봐요"라며 열림

[절대 하지 말아야 할 것]
- 매 턴마다 "필요 없어요", "됐어요"로만 끝내는 것 → 비현실적입니다
- 세일즈맨이 좋은 말을 해도 무시하고 계속 거부만 하는 것 → 현실에서 없습니다
- 적대적·싸우는 어투, 반말, 무시하는 말투 → 비즈니스 대표는 이렇게 말하지 않습니다
- 괄호() 안에 생각·행동·설명을 넣는 것 → 오직 실제 말(대사)만 출력하세요
- 비서·직원·제3자 역할 → 당신은 항상 대표 본인입니다. 전화를 받는 것도, 방문객을 맞이하는 것도 대표가 직접 합니다. 비서나 다른 인물이 등장하거나 "잠시만요, 연결해드리겠습니다" 식으로 제3자를 끼워 넣지 마세요

[형식]
- 반드시 한국어만 사용
- 2~3문장 이내의 짧고 자연스러운 구어체
- ${situationRule}`;

  const chatHistory = [];

  return {
    sendMessage: async (userMessage) => {
      const data = await callProxy({
        action: 'chat',
        systemInstruction,
        history: chatHistory,
        message: userMessage,
      });
      chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });
      chatHistory.push({ role: 'model', parts: [{ text: data.text }] });
      return { response: { text: () => data.text } };
    },
  };
}

export async function generateFeedback(chatHistory) {
  const historyText = chatHistory
    .map(m => `${m.role === 'user' ? '세일즈맨' : '고객'}: ${m.text}`)
    .join('\n');

  const prompt = `당신은 20년 경력의 세일즈 트레이너입니다. 아래 세일즈 대화를 심층 분석해 JSON 피드백을 작성하세요.

대화:
${historyText}

평가 기준:
- 오프닝 임팩트 (첫 인상, 관심 유발)
- 니즈 파악 (질문의 질, 경청 능력)
- 가치 제안 (고객 문제와 상품 연결)
- 반론 처리 (objection handling 기술)
- 클로징 시도 (다음 단계 제안)
- 대화 흐름 (자연스러움, 공감 표현)

반드시 아래 JSON만 반환하세요 (마크다운 없이 순수 JSON):
{
  "score": 0~100 사이 정수,
  "summary": "이 세일즈 대화의 핵심 특징과 전반적 수준을 2~3문장으로 서술. 구체적 대화 내용을 근거로 제시.",
  "good": [
    "잘한 점 1: 구체적으로 어떤 말/행동이 왜 효과적인지 설명 (50자 내외)",
    "잘한 점 2",
    "잘한 점 3",
    "잘한 점 4",
    "잘한 점 5"
  ],
  "improve": [
    "개선할 점 1: 어떤 상황에서 무엇이 부족했고, 어떻게 바꿔야 하는지 구체적 방향 제시 (60자 내외)",
    "개선할 점 2",
    "개선할 점 3",
    "개선할 점 4",
    "개선할 점 5"
  ],
  "scripts": [
    "상황: [어떤 상황에 쓰는 멘트인지] → 멘트: [실제 사용 가능한 자연스러운 한국어 구어체 멘트]",
    "상황: ... → 멘트: ...",
    "상황: ... → 멘트: ...",
    "상황: ... → 멘트: ...",
    "상황: ... → 멘트: ..."
  ]
}`;

  const data = await callProxy({ action: 'generate', prompt });
  let text = data.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}

export async function generateCallScript(product, customerProfile, personality, painPoints) {
  const prompt = `다음 정보를 바탕으로 전화 영업(TA) 스크립트를 작성해주세요.

판매 상품: ${product}
고객 프로필: ${customerProfile}
고객 성격: ${personality}
고객 애로사항: ${painPoints}

아래 5단계 구조로 구체적인 스크립트를 작성해주세요:

## 📞 1단계: 오프닝 멘트
(자연스럽게 통화를 시작하는 2~3가지 멘트 예시)

## 🔍 2단계: 니즈 파악 질문
(고객의 상황과 니즈를 파악하는 핵심 질문 3~5가지)

## 🎯 3단계: 상품 소개 포인트
(고객 애로사항을 해결하는 핵심 가치 3가지와 구체적 멘트)

## 🛡️ 4단계: 예상 반론 대응
(자주 나오는 거절 3가지와 각 대응 멘트)

## 🤝 5단계: 클로징 멘트
(부드럽게 다음 단계로 넘어가는 클로징 멘트 2~3가지)

실제 사용 가능한 자연스러운 한국어 구어체로 작성해주세요.`;

  const data = await callProxy({ action: 'generate', prompt });
  return data.text;
}

export async function correctVoiceTranscript(rawText, context) {
  const prompt = `음성인식 오류 수정 전문가입니다. 아래 문맥을 참고해 음성인식 텍스트에서 잘못 인식된 고유명사(회사명·브랜드명·상품명·지명·인명)만 교정하세요. 일반 단어나 문법은 절대 바꾸지 마세요. 수정된 텍스트만 반환하세요 (설명 없이).
문맥: ${context}
음성인식 텍스트: ${rawText}`;

  const data = await callProxy({ action: 'generate', prompt });
  const corrected = data.text.trim().replace(/^["']|["']$/g, '');
  return corrected || rawText;
}

export async function generateUpsellStrategy(product, customersText, industry = '기타') {
  const prompt = `당신은 현장 영업 전문가입니다. 아래 정보를 바탕으로 개인 세일즈맨이 현장에서 즉시 실행할 수 있는 매출 확대 전략을 작성하세요. 기업 단위 전략이 아니라 세일즈맨 개인이 고객에게 말하고 행동하는 방식으로 작성하세요.

판매 상품: "${product}"
업종: ${industry}
기존 고객 설명: ${customersText}

반드시 아래 JSON 형식만 반환하세요 (마크다운 코드블록 없이 순수 JSON만):
{
  "recurring": {
    "title": "반복 매출 전략",
    "actions": [
      "세일즈맨이 직접 실행하는 구체적 행동 1 (예: 계약 후 30일에 직접 전화해 사용 현황을 묻는다)",
      "행동 2", "행동 3", "행동 4", "행동 5"
    ],
    "script": "고객에게 직접 하는 실제 말투의 멘트 (예: '고객님, 지난번 계약 이후 잘 활용하고 계신가요? 혹시 추가로 필요한 부분이 생기셨다면...')"
  },
  "upsell": {
    "title": "업셀링 전략",
    "actions": ["행동 1", "행동 2", "행동 3", "행동 4", "행동 5"],
    "script": "실제 멘트"
  },
  "crosssell": {
    "title": "크로스셀링 전략",
    "actions": [
      "연관 상품·서비스를 자연스럽게 연결하는 구체적 행동 1",
      "행동 2", "행동 3", "행동 4", "행동 5", "행동 6"
    ],
    "script": "크로스셀링 제안 실제 멘트 (현재 상품과 연결되는 이유를 자연스럽게 설명하는 구어체)"
  },
  "renewal": {
    "title": "갱신 계약 전략",
    "actions": ["행동 1", "행동 2", "행동 3", "행동 4", "행동 5"],
    "script": "실제 멘트"
  }
}`;

  const data = await callProxy({ action: 'generate', prompt });
  let text = data.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}

export async function generateCustomerExpansion(product, currentCustomers, channelsText) {
  const prompt = `당신은 현장 영업 코치입니다. 모든 내용은 개인 세일즈맨 입장에서, 현장에서 즉시 실행할 수 있는 행동과 말로 작성하세요. 기업 단위 전략(마케팅 캠페인, 조직 개편 등)은 절대 쓰지 마세요.

판매 상품: ${product}
현재 주요 고객층: ${currentCustomers}
현재 판매 채널: ${channelsText}

반드시 아래 JSON 형식으로만 반환하세요 (마크다운 없이):

{
  "customerExpansion": {
    "currentProfile": "현재 고객 특성 분석: 세일즈맨 관점에서 이 고객들의 공통 특징과 구매 동기 (2~3문장)",
    "newSegments": [
      {
        "segment": "새로 접근할 구체적 고객 유형 (예: '최근 결혼한 30대 맞벌이 부부')",
        "reason": "왜 이 고객층이 이 상품을 필요로 하는지 세일즈맨 관점의 근거",
        "approach": "세일즈맨이 이 고객에게 직접 다가가는 방법 (어디서 만나고, 어떻게 말을 걸고, 어떤 포인트를 강조하는지)"
      },
      {"segment": "...", "reason": "...", "approach": "..."},
      {"segment": "...", "reason": "...", "approach": "..."},
      {"segment": "...", "reason": "...", "approach": "..."}
    ]
  },
  "productChange": {
    "ideas": [
      {
        "type": "제안 유형 (예: 패키지화, 소액 분할 진입, 체험판 제공 등)",
        "idea": "세일즈맨이 직접 고객에게 제안하는 방식 (어떻게 말하고, 어떻게 묶어서 제시하는지)",
        "benefit": "고객이 느끼는 실질적 이점 + 세일즈맨에게 돌아오는 영업 효과"
      },
      {"type": "...", "idea": "...", "benefit": "..."},
      {"type": "...", "idea": "...", "benefit": "..."},
      {"type": "...", "idea": "...", "benefit": "..."}
    ]
  },
  "salesMethod": {
    "channelStrategies": [
      {
        "from": "현재 주로 쓰는 채널",
        "to": "추가하거나 전환할 채널",
        "strategy": "세일즈맨이 이 채널에서 구체적으로 무엇을 하는지 (행동 중심으로 서술)"
      },
      {"from": "...", "to": "...", "strategy": "..."},
      {"from": "...", "to": "...", "strategy": "..."}
    ],
    "realCases": [
      {
        "company": "실존 세일즈맨 이름 — 반드시 실제로 실적·저서·인터뷰로 검증된 세계적 세일즈 전설을 선택하세요 (예: 조 지라드·기네스북 역대 최다 자동차 판매, 우노 다카시·일본 최고 요리사 겸 서비스 달인, 프랭크 베트거·보험왕, 론 포펄·TV홈쇼핑 판매왕, 브라이언 트레이시·세일즈 코치, 데이비드 오길비·광고 세일즈, 마크 큐반·창업 세일즈 등). 반드시 판매 상품(${product})과 연결할 수 있는 인물을 선택하세요.",
        "product": "그 사람이 실제로 팔았던 상품/업종",
        "before": "그가 극복한 초기 어려움 또는 기존의 평범한 방식",
        "after": "그만의 독창적 접근으로 이룬 구체적 성과 (숫자·기록 포함)",
        "lesson": "이 세일즈맨의 핵심 방식을 현재 상품(${product}) 세일즈에 즉시 적용하는 구체적 행동 (단순 참고가 아닌 '내일 당장 실천할 수 있는' 연결점)"
      },
      {"company": "두 번째 실존 세일즈 전설 (첫 번째와 다른 업종·국가)", "product": "...", "before": "...", "after": "...", "lesson": "..."},
      {"company": "세 번째 실존 세일즈 전설 (한국인 세일즈 고수 포함 가능: 현장 보험·자동차·부동산 등)", "product": "...", "before": "...", "after": "...", "lesson": "..."}
    ]
  }
}`;

  const data = await callProxy({ action: 'generate', prompt });
  let text = data.text.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}
