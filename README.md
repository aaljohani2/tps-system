# TPS System — Full-Stack V1 (local development branch)

> **Important: In progress, not ready for institutional use or Rayat.** This branch is separate from `main`; historical prototype notes are retained below.

## Primary deployment target: Windows local production

The FIRST operational target is a **dedicated, persistent, single-workstation production profile**, not a cloud server or the old synthetic browser database. Read [Windows local production](docs/LOCAL_PRODUCTION_WINDOWS.md). Once the existing `.env` is left untouched and the pinned application is built, run `npm run local:production:init`, create the one-time initial admin with `npm run local:production:bootstrap`, and launch `npm run local:production:start`. `/health` must report `mode: local-production`. The operational PostgreSQL database `tps_operational_local` is separate from all old test databases and is never automatically seeded. Use `local:production:backup` (not the original test `db:backup`) to protect that database. A user-logon auto-start task is available in `scripts/local-production.ps1`. No external hosting required. Institutional personal data still require the necessary operator authorization and protections.

## Real local workflow

Sign in → select institution, college, department and term → import courses (CSV/XLSX with preview/commit) → enter demand, instructors, rooms and blocks → generate draft sections → run Java Timefold → optionally move verified draft sessions with an audit reason → inspect readiness, sessions, loads and uncovered work → fork and compare scenarios → review/approve if eligible → export CSV/Excel. Record Timefold run history and explicitly approve trainer overloads before they can affect newly generated scenarios.

This release also includes a scoped CSV/XLSX bulk import page for instructors, rooms, blocks and demand (preview → explicit commit), and additional saved-scenario Excel reports grouped by trainer, room, level and student cohort.
 
This release includes a React RTL frontend, Fastify API, PostgreSQL persistence, Argon2id session authentication, scoped routes, audit records and a Java Timefold bridge reused from the tested prototype. **Greedy output is explicitly a draft, never an optimized/approved result.**

### Local prerequisites

Node.js 22+, npm, Docker Desktop/Compose (or a separate local PostgreSQL), Java 21, Maven, Python 3 and openpyxl. The API binds to `127.0.0.1:8787` and PostgreSQL to `127.0.0.1:54329` by default. No cloud infrastructure is required.

### Installation on Windows

1. Preserve any existing local changes in `H:\\tps_system`. Do not reset or clean the repository.
2. Switch to `feat/full-stack-tps-v1` after checking `git status`.
3. Create `.env` from `.env.example`, generate a unique high-entropy `TPS_DB_PASSWORD` and set a matching URL-encoded password in `DATABASE_URL`.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/local.ps1 setup`.
5. Set `TPS_BOOTSTRAP_PASSWORD` to a strong 16+ character value only in the current shell and run `npm run db:bootstrap`. Unset the variable afterward.
6. Run `npm start` and visit `http://127.0.0.1:8787`.

Before pulling an existing Windows checkout, back up untracked local npm lockfiles, reports and database configuration; the branch now tracks `package-lock.json` and `frontend/package-lock.json`. Reproducible dependency installation uses `npm ci` at the root and `npm run web:install` in the frontend. Source CI cannot substitute for rerunning local Windows A01–A59. **For any operational or production plans, follow [production readiness and go/no-go](docs/PRODUCTION_READINESS.md) first.**

See [encrypted backup/isolated restore drill](docs/BACKUP_RESTORE.md), [production readiness](docs/PRODUCTION_READINESS.md) and [local acceptance matrix](docs/ACCEPTANCE_MATRIX.md), [local deployment](docs/DEPLOYMENT_LOCAL.md), [implementation ledger](docs/IMPLEMENTATION_STATE.md), and [Codex local handoff](docs/CODEX_LOCAL_HANDOFF.md). **Do not interpret remote CI as proof that your local installation passed.**

---

## Historical v0.3 prototype README (retained for traceability)

# TPS | نظام تخطيط وجدولة التدريب

نظام عربي قابل للتوسع لتقدير الطلب على المقررات، وتوليد الشعب، وإسناد المدربين، وفحص القيود الزمنية والمكانية، وإظهار العجز **دون إخفائه**.

> **الحالة: Prototype v0.2 / Draft only.** لم يُعتمد النظام للتشغيل الفعلي، ولا ينشر أي شعب إلى رايات. يعمل المحرك الحالي بخوارزمية تجريبية حتمية (greedy) ويحتاج لاحقًا إلى ربط Timefold Solver تجريبي يختار بين بدائل محدودة للشعب، لكن بناءه Java لم يُتحقق منه بعد؛ لا يُعتبر محرك تحسين إنتاجيًا.

## قواعد الطبقات

| النمط | النظري | العملي | الخصائص | الحالة الافتراضية |
|---|---:|---:|---|---|
| حضوري `ONSITE` | 45 | 30 | قاعة/معمل فعلي | مفعل |
| عن بُعد `REMOTE` | 120 | 120 | لقاء متزامن دون قاعة فعلية | معطل |
| ذاتي `SELF_PACED` | بلا سقف | بلا سقف | لا لقاء أسبوعي متزامن؛ سياسة نصاب مستقلة | معطل |
| مدمج `HYBRID` | 45 | 45 | حضوري قبل 12:00، وبعيد 16:00–22:00 | معطل |

- المقرر المختلط يُولد زوجًا 1:1 (نظري + عملي لنفس المجموعة). السعة الفعلية للزوج هي **أصغر السعتين**: حضوري 30، عن بُعد 120، مدمج 45.
- العملي عن بُعد يحتسب `2/3` من الساعة في النصاب *كقاعدة تخطيطية قابلة للتغيير*، بينما ساعات التدريس الفعلية مستقلة.
- لا تتجاوز حدود النصاب إلا باستثناء معلن ومسبب. لا تُسند الشعب المستحيلة آليًا لإخفاء العجز.
- منع الخميس بعد 10:00، وتفضيل الأحد–الأربعاء؛ مجموعة متدربين مشتركة (`blockId`) لا تحضر لقاءين متزامنين.
- **النمط والأهلية قرار إداري**: تفعيل الطبقة لا يجيز تلقائيًا تقديم مقرر عملي إلكترونيًا.

## تجربة تشغيل محلي

المتطلبات: Node.js **22+**، وnpm.

```bash
npm install
npm test
npm run demo
npm run build
npm start
```

افتح `http://127.0.0.1:8787`؛ واجهة أولية RTL فيها مثال اصطناعي وزر «بناء مسودة الجدول» وجداول المدربين والقاعات والمستويات والبلوكات.

يمكن استدعاء API مباشرة:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/v1/policy/default
curl -X POST http://127.0.0.1:8787/api/v1/plans/preview \
  -H 'Content-Type: application/json' --data-binary @examples/onsite.json
```

**الملف `examples/onsite.json` اصطناعي بالكامل**؛ لا يحوي بيانات متدربين أو بيانات حقيقية للمدربين.

## هيكل المشروع

```text
src/
  optimizer.ts       Timefold candidate generation and runtime bridge
  importer.ts        CSV curriculum import
  types.ts          Domain contracts / models
  policy.ts         Four-mode default policy
  validation.ts     Input and eligibility validation
  planner.ts        Deterministic draft section/assignment/timing engine
  server.ts         Local-only JSON API + static UI
  demo.ts           CLI sample runner
web/                 Arabic RTL prototype
examples/            Synthetic example data
scripts/             Python XLSX importer and tests
solver/              Java 21 Timefold candidate optimizer (Maven)
tests/               Node built-in test runner
docs/                Requirements, architecture, ADRs, API, security, roadmap
.github/workflows/   CI build + tests
```

## حالة الوظائف الحالية

**تم تنفيذه واختباره محليًا:** السعات والطبقات الأربع كقواعد نطاق، بوابات التفعيل والأهلية، تكوين الأزواج، نصاب عملي البعد، أنصبة المدربين واستثناءاتها، الكشف عن العجز، مواقع المحاضرات، إتاحة البلوكات، قيد الخميس، وعرض النتائج داخل واجهة محلية.

**نُفذ في v0.2 مبدئيًا:** استيراد كتالوج المقررات من CSV؛ ومحول XLSX محلي، وواجهة Timefold Java مع مدخلات ومخرجات JSON وقيود أساسية. **لم يتم اختبار Java فعليًا في البيئة الحالية** لغياب Maven/اتصال الحزم؛ تحققت فقط اختبارات Node/Python.

**لم يُنفّذ بعد:** التشغيل المؤكد لمحرك Timefold في بيئة CI، تقارير التسجيل من رايات، المصادقة والصلاحيات، التخزين الدائم، تزامن البيانات متعددة الأقسام، مقارنة السيناريوهات المعتمدة، اعتماد الجداول وإصدار ملفات رايات الرسمية، وتوليد الحل الأمثل.

لا توجد دعوى بأن النتائج «خالية من تعارض المتدربين» إذا لم تُزود هوية البلوك/الفوج؛ المحرك يعطي تنبيهًا بهذا القيد.

## المراجع الداخلية

- [المتطلبات التشغيلية للأربع طبقات](docs/requirements-four-layers.md)
- [القرارات المعمارية](docs/adr/0001-modular-monolith-and-solver-boundary.md)
- [قواعد الحساب والتحقق](docs/business-rules.md)
- [عقد API](docs/api.md)
- [الأمن والخصوصية](docs/security.md)
- [خارطة الطريق](docs/roadmap.md)

**الترخيص:** لم يُحدد بعد، والمستودع خاص حاليًا؛ لا يُفترض نشره أو فتح ترخيص دون قرار مالك المشروع.

## تحديث v0.2 — استيراد البيانات ومحرك Timefold

```bash
npm run import:csv -- source.csv catalog.json
python scripts/import_xlsx.py source.xlsx --out catalog.json
cd solver && mvn -B -ntp clean package
```

لتحسين الجدول بعد بناء المحرك: POST `/api/v1/plans/optimize`، أو استخدم زر «تحسين بـ Timefold» في الواجهة المحلية. **الفشل ظاهر ولا يتم استبداله بنتيجة المحرك التجريبي بصمت**. انظر [توثيق الربط](docs/timefold-integration.md) و[توثيق الاستيراد](docs/importing-data.md).


### استيراد Excel مباشرة (v0.3 قيد المراجعة)

من الواجهة المحلية: **تحميل قالب Excel** ← إدخال الطلب المتوقع ← **رفع ملف Excel/CSV** ← **قراءة وتحقق**.
يتطلب تشغيل الخادم Python 3 مع `openpyxl` لاستيراد XLSX. الاستيراد لا يعتمد الجدول ولا ينشره إلى رايات ولا يستورد المدربين أو القاعات؛ اقرأ `docs/importing-data.md`.

## Original mandate phase 10/11 implementation

See [Phase 10/11 traceability](docs/PHASE_10_11_CLOSEOUT.md). The app includes all five scoped CSV/XLSX import templates, a reviewed batch commit flow and independent course-mode approvals. The four-view weekly timetable supports session selection, record-linked constraints and staged drag/drop backed by audited API checks. It offers detailed Arabic RTL Excel and a printable summary that the browser can save as PDF. These are local planning tools, **not Rayat integration or official college approvals**.
