# TeachEase system flowchart

```mermaid
flowchart TD
  Teacher([Teacher])

  subgraph Phone["Teacher app / phone (not included in this repository)"]
    UI[Review and approval UI]
    Offline[Offline capture and local records]
    Recognition[On-device recognition and scoring]
    Queue[Pending result uploads]
    Teacher --> UI
    UI --> Offline
    Offline --> Recognition
    Recognition --> Offline
    Offline --> Queue
  end

  subgraph Identity["Identity"]
    Login[Sign in and complete MFA]
    Auth[Supabase Auth]
  end

  subgraph Backend["TeachEase backend"]
    API[FastAPI endpoints]
    Verify{Valid token and required MFA?}
    Validate[Validate request, ownership, and revision]
    Assessment[Manage assessment and answer-key versions]
    Scoring[Deterministic scoring and submission workflow]
    Upload[Atomic, idempotent offline upload]
    Reports[Approved-result performance evidence]
    AIChoice{Explicit OCR or AI request?}
    AI[Gemini OCR or teaching-material draft]
    Review[Teacher reviews and edits draft]
  end

  DB[(Supabase PostgreSQL<br/>forced row-level security)]
  Gemini[(Google Gemini API)]
  Error[Return structured API error]

  UI --> Login
  Login --> Auth
  Auth -->|Access token| UI
  UI -->|Authenticated API request| API
  Queue -->|Explicit upload when online| API
  API --> Verify
  Verify -->|No| Error
  Verify -->|Yes| Validate
  Validate -->|Invalid, unauthorized, or stale| Error
  Validate -->|Assessment or answer-key action| Assessment
  Validate -->|Score, edit, or approve result| Scoring
  Validate -->|Offline result upload| Upload
  Validate -->|Performance or consultation| Reports
  Validate --> AIChoice

  Assessment -->|Create or verify key| DB
  Scoring -->|Save draft, adjustments, approval| DB
  Upload -->|Save records and retry receipt in one transaction| DB
  Reports -->|Read approved evidence; save snapshots| DB
  DB -->|Persisted records and results| API
  Assessment --> UI
  Scoring --> UI
  Upload --> UI
  Reports --> UI

  AIChoice -->|No| Error
  AIChoice -->|Yes| AI
  AI -->|Validated content, server-side credentials| Gemini
  Gemini -->|Generated OCR/material draft| AI
  AI -->|Draft and provenance| Review
  Review -->|Teacher edits/reviews| API
  Review -->|Unaccepted draft| UI
  Error --> UI
```

## Important boundaries

- Offline capture, local storage, and device-side recognition/scoring belong to a companion app; they are not implemented in this backend repository.
- The phone uses Supabase Auth for login. The backend verifies the access token and enforces teacher ownership on protected API requests.
- Objective answer scoring is deterministic. Gemini output is only a draft and requires teacher review; it does not approve grades.
- Uploaded result records do not include paper images. Images are sent to Gemini only for an explicit online OCR request and are not retained by this release.
- The database uses PostgreSQL row-level security in production. Local development can use SQLite.
