# Recall Coach

A voice study partner for Alexa+. Give it your lecture notes, then say "quiz me". It asks you questions out loud, grades your spoken answer for meaning (not exact wording), tells you what you missed, and uses spaced repetition to bring weak topics back sooner and strong topics back later.

Built for the Alexa+ track and AWS Builder mini challenge of the Build, Ship, Shape: Amazon Developer Hackathon 2026.

## Why

Rereading notes feels productive but is one of the weakest ways to study. Active recall (answering from memory) and spaced repetition are two of the best supported learning techniques, yet they take effort to set up. Recall Coach does that setup for you and runs the session hands free, so you can study while walking, cooking, or commuting.

## How it works

Recall Coach is a self hosted MCP server (spec 2025-11-25, Streamable HTTP) that Alexa+ or any MCP client can call.

| Tool | What it does |
| --- | --- |
| `load_study_notes` | Turns raw notes into a deck of spoken quiz questions |
| `quiz_me` | Asks the next question: whatever is due first, otherwise your weakest concept |
| `check_answer` | Grades the spoken answer, gives feedback, schedules the next review |
| `study_progress` | Mastery, due reviews, average score, weakest concepts |
| `list_topics` | Lists your loaded topics |

Every tool returns a `speech` field written to be read aloud, plus structured data.

**AI:** question generation and grading run on Amazon Bedrock (Converse API) when `AI_PROVIDER=bedrock`. Without AWS credentials it falls back to a local rule based generator and keyword grader, so the project always runs.

**Scheduling:** an SM-2 style algorithm. A missed card returns in about 10 minutes; a correct card returns in 1 day, then 3, then at growing intervals.

## Run it

```bash
npm install
npm start          # MCP server on http://localhost:3000/mcp
npm test           # end to end test as a real MCP client
```

With Bedrock:

```bash
AI_PROVIDER=bedrock AWS_REGION=us-east-1 BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 npm start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `AI_PROVIDER` | `local` | `bedrock` or `local` |
| `BEDROCK_MODEL_ID` | `us.amazon.nova-lite-v1:0` | Any Bedrock model that supports Converse |
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `DATA_FILE` | `data/store.json` | Local learner store |

## Project layout

```
src/server.js   MCP server and HTTP transport
src/coach.js    Study session logic (shared by MCP and the web demo)
src/ai.js       Bedrock generation and grading, with local fallback
src/srs.js      Spaced repetition scheduling
src/store.js    Storage (JSON file now, DynamoDB next)
test/smoke.js   End to end MCP client test
```

## License

MIT
