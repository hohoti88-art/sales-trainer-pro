import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

function getClient() {
  if (!API_KEY || API_KEY === 'your_api_key_here') {
    throw new Error('Gemini API 키가 설정되지 않았습니다. .env 파일에 VITE_GEMINI_API_KEY를 설정해주세요.');
  }
  return new GoogleGenerativeAI(API_KEY);
}

export async function startPersonaChat(product, customerProfile, personality, painPoints, mode = 'visit') {
  const genAI = getClient();
  const situationRule = mode === 'call'
    ? '이것은 전화 영업 연습입니다. 첫 응답은 반드시 전화를 받는 상황으로 시작하세요 (예: "여보세요?", "네, 말씀하세요.", "네, 누구세요?").'
    : '이것은 방문 대면 영업 연습입니다. 첫 응답은 반드시 방문객을 맞이하는 상황으로 시작하세요 (예: "어떤 일로 오셨습니까?", "무슨 일이세요?", "어서 오세요, 무슨 용건이신가요?").';
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `당신은 세일즈 트레이닝을 위한 가상 고객입니다.
고객 프로필: ${customerProfile}
성격 유형: ${personality}
현재 고객의 애로사항: ${painPoints}
판매 상품: ${product}

역할 수행 규칙:
1. 반드시 한국어로만 대화하세요.
2. 위 프로필에 맞는 현실적인 고객처럼 행동하세요.
3. 성격 유형별 초기 태도:
   - 까다로운형: 트집을 잡고 날카롭게 질문하지만, 논리적으로 납득되면 "그 부분은 그렇군요" 식으로 조금씩 인정
   - 바쁜형: 처음엔 귀찮아하지만, 핵심을 짧게 잘 전달하면 "그게 뭔데요?" 하며 관심을 보임
   - 친절한형: 호의적이지만 신중. 공감을 잘 받으면 "사실 그 부분이 좀 걸렸는데..." 하며 속내를 꺼냄
   - 의심형: 근거와 증거를 요구하지만, 구체적 데이터나 사례를 제시하면 "그 사례 좀 더 얘기해보세요" 하며 열림
4. 태도 변화 곡선을 반드시 따르세요:
   - 초반(1~3턴): 방어적·거부적 반응
   - 중반(4~6턴): 세일즈맨이 애로사항을 정확히 짚거나 공감하면 "그건 맞는 말이네요", "음, 그 부분은..." 식으로 조금씩 마음이 열림
   - 후반(7턴~): 관심 표현 또는 조건부 검토 ("한번 자료 보내줘 봐요", "가격이 맞으면 생각해볼게요" 등)
   - 단, 세일즈맨이 엉뚱한 대응을 하거나 고객 입장을 무시하면 다시 닫힘
5. 절대로 단순 거절만 반복하지 마세요. 거절하더라도 이유를 말하고, 세일즈맨에게 다음 기회를 줄 수 있는 여지를 남기세요.
6. 구매 결정은 쉽게 내리지 마세요. 하지만 "가능성 있음"의 신호는 대화 흐름에 따라 자연스럽게 보내세요.
7. 짧고 자연스러운 대화체로 응답하세요 (2~4문장 이내).
8. ${situationRule}
9. 절대로 괄호() 안에 어떤 내용도 쓰지 마세요. '속으로 생각', 행동 묘사, 상황 설명, 감정 서술 일체 금지. 오직 실제 말(대사)만 출력하세요.`,
  });

  const chat = model.startChat({ history: [] });
  return chat;
}

export async function generateFeedback(chatHistory) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}

export async function generateCallScript(product, customerProfile, personality, painPoints) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function correctVoiceTranscript(rawText, context) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(
    `음성인식 오류 수정 전문가입니다. 아래 문맥을 참고해 음성인식 텍스트에서 잘못 인식된 고유명사(회사명·브랜드명·상품명·지명·인명)만 교정하세요. 일반 단어나 문법은 절대 바꾸지 마세요. 수정된 텍스트만 반환하세요 (설명 없이).
문맥: ${context}
음성인식 텍스트: ${rawText}`
  );
  const corrected = result.response.text().trim().replace(/^["']|["']$/g, '');
  return corrected || rawText;
}

export async function generateUpsellStrategy(product, customersText, industry = '기타') {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}

export async function generateCustomerExpansion(product, currentCustomers, channelsText) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
        "company": "실존 세일즈맨 또는 기업가 이름 (예: 조 지라드, 우노 다카시, 자이언트 조 등)",
        "product": "그 사람이 팔았던 상품/업종",
        "before": "기존 방식 또는 어려움",
        "after": "독창적 접근으로 거둔 성과",
        "lesson": "현재 상품(${product}) 세일즈에 적용할 수 있는 구체적 교훈 (단순 참고가 아닌 실행 가능한 연결점)"
      },
      {"company": "...", "product": "...", "before": "...", "after": "...", "lesson": "..."},
      {"company": "...", "product": "...", "before": "...", "after": "...", "lesson": "..."}
    ]
  }
}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}
