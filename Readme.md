# 🏠 SH 임대주택 통합 대시보드 (v1)

서울주택도시공사(SH)의 **행복주택**과 **장기전세** 공고를 한곳에서 실시간으로 조회할 수 있는 웹 대시보드입니다.
Node.js Express를 백엔드로 사용하여 CORS 문제를 해결하고, Cheerio를 통해 데이터를 수집하여 Bento Grid 스타일의 모던한 UI로 제공합니다.

![Dashboard Preview](https://via.placeholder.com/800x400?text=SH+Dashboard+Preview) ## ✨ 주요 기능

* **통합 조회:** 행복주택(`07`)과 장기전세(`03`) 공고를 병렬로 조회하여 하나의 리스트로 합쳐서 보여줍니다.
* **카테고리 구분:** 공고 유형(행복/장기)에 따라 다른 색상의 뱃지(Badge)로 시각적으로 구분합니다.
* **필터링:** 전체 공고 또는 모집 중인 공고만 필터링하여 조회할 수 있습니다.
* **스마트 링크:** SH 사이트의 복잡한 링크 로직(Javascript 호출, 상대 경로 등)을 자동으로 분석하여 바로 접속 가능한 URL로 변환합니다.
* **성능 최적화:** `node-cache`를 적용하여 동일한 요청에 대해 1시간 동안 데이터를 캐싱, 응답 속도를 높이고 SH 서버 부하를 줄입니다.
* **모던 UI:** Glassmorphism(유리 질감) 디자인과 Neon Effect를 적용한 다크 모드 인터페이스입니다.

## 🛠 기술 스택

### Backend
* **Runtime:** Node.js
* **Framework:** Express.js
* **Scraping:** Cheerio, Axios
* **Utilities:** Node-cache (Caching), Express-rate-limit (DDos 방지)

### Frontend
* **Core:** HTML5, CSS3, Vanilla JavaScript (No Framework)
* **Layout:** CSS Grid (Bento Grid Layout)
* **Design:** Glassmorphism, Responsive Web Design

## 📂 프로젝트 구조

```text
my-dashboard/
├── package.json          # 의존성 및 프로젝트 설정
├── app.js                # [Main] 서버 진입점 및 라우팅 설정
├── src/
│   ├── controllers/      # 비즈니스 로직 (스크래핑, 데이터 병합)
│   │   └── housingController.js
│   └── utils/            # 공통 유틸리티 (응답 포맷)
│       └── apiResponse.js
└── public/               # 프론트엔드 정적 파일
    ├── index.html        # UI 구조 및 로직 통합 (HTML/CSS/JS)