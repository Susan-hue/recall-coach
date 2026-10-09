// Recall Coach: an Alexa+ MCP server for voice-first active recall study.
// Transport: MCP Streamable HTTP (spec 2025-11-25), stateless, at POST /mcp.
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadNotes, nextQuestion, submitAnswer, getProgress, listDecks } from './coach.js';
import { aiProvider } from './ai.js';

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_LEARNER = 'demo';

const learnerArg = z
  .string()
  .optional()
  .describe('Stable identifier for the learner. Omit to use the default learner.');

function reply(result) {
  return {
    content: [{ type: 'text', text: result.speech }],
    structuredContent: result,
  };
}

function fail(err) {
  return { isError: true, content: [{ type: 'text', text: err.message }] };
}

export function buildMcpServer() {
  const server = new McpServer(
    { name: 'recall-coach', version: '0.1.0' },
    {
      instructions:
        'Recall Coach is a voice study partner that uses active recall and spaced repetition. ' +
        'Typical flow: load_study_notes once per topic, then loop quiz_me -> (user answers aloud) -> check_answer. ' +
        'Always read the `speech` field to the user verbatim; it is written to be spoken. ' +
        'Pass the user\'s spoken answer to check_answer exactly as said, without correcting it.',
    }
  );

  server.registerTool(
    'load_study_notes',
    {
      title: 'Load study notes',
      description: 'Turn a block of study notes into a deck of spoken quiz questions for a topic.',
      inputSchema: {
        title: z.string().min(1).describe('Short topic name, e.g. "Database normalization".'),
        notes: z.string().min(20).describe('The raw study notes text.'),
        learner_id: learnerArg,
      },
    },
    async ({ title, notes, learner_id }) => {
      try {
        return reply(await loadNotes(learner_id || DEFAULT_LEARNER, { title, notes }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'quiz_me',
    {
      title: 'Quiz me',
      description:
        'Ask the learner the next question. Picks whatever is due for review first; if nothing is due, picks their weakest concept.',
      inputSchema: {
        topic: z.string().optional().describe('Optional topic title or deck id to restrict the quiz to.'),
        learner_id: learnerArg,
      },
      annotations: { readOnlyHint: false },
    },
    async ({ topic, learner_id }) => reply(nextQuestion(learner_id || DEFAULT_LEARNER, { deck: topic }))
  );

  server.registerTool(
    'check_answer',
    {
      title: 'Check answer',
      description:
        "Grade the learner's spoken answer to the current question, give feedback, and schedule the next review.",
      inputSchema: {
        answer: z.string().describe("The learner's answer, exactly as spoken."),
        card_id: z.string().optional().describe('Question id from quiz_me. Defaults to the open question.'),
        learner_id: learnerArg,
      },
    },
    async ({ answer, card_id, learner_id }) => {
      try {
        return reply(await submitAnswer(learner_id || DEFAULT_LEARNER, { answer, card_id }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'study_progress',
    {
      title: 'Study progress',
      description: 'Summarize mastery, due reviews, average score and weakest concepts, overall or for one topic.',
      inputSchema: { topic: z.string().optional(), learner_id: learnerArg },
      annotations: { readOnlyHint: true },
    },
    async ({ topic, learner_id }) => reply(getProgress(learner_id || DEFAULT_LEARNER, { deck: topic }))
  );

  server.registerTool(
    'list_topics',
    {
      title: 'List topics',
      description: 'List the study topics the learner has loaded.',
      inputSchema: { learner_id: learnerArg },
      annotations: { readOnlyHint: true },
    },
    async ({ learner_id }) => reply(listDecks(learner_id || DEFAULT_LEARNER))
  );

  return server;
}

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ai: aiProvider() }));

  // Stateless Streamable HTTP: a fresh server + transport per request.
  // Learner state lives in the store, so nothing is lost between requests.
  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  const methodNotAllowed = (_req, res) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildApp().listen(PORT, () => {
    console.log(`Recall Coach MCP server on http://localhost:${PORT}/mcp (AI: ${aiProvider()})`);
  });
}
