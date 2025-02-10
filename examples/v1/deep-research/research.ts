import { action, render } from "@daydreamsai/core/src/core/v1/utils";
import { createTagParser, formatXml } from "@daydreamsai/core/src/core/v1/xml";
import { TavilyClient } from "@tavily/core";
import { generateText, LanguageModelV1 } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import {
  finalReportPrompt,
  searchResultsParser,
  searchResultsPrompt,
} from "./prompts";
import { researchSchema, searchResultsSchema } from "./schemas";

export type Research = {
  id: string;
  name: string;
  queries: {
    query: string;
    goal: string;
  }[];
  questions: string[];
  learnings: string[];
  status: "in_progress" | "done";
};

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

const ConcurrencyLimit = 1;
const limit = pLimit(ConcurrencyLimit);

async function retry<T>(
  key: string,
  fn: () => Promise<T>,
  retries: number = 3
) {
  console.log("trying", { key });
  while (retries > 0) {
    try {
      return await fn();
    } catch (error) {
      retries--;
      if (retries === 0) {
        throw error;
      }
    }
  }
}

export async function startDeepResearch({
  model,
  research,
  tavilyClient,
  maxDepth,
  onProgress,
}: {
  model: LanguageModelV1;
  research: Research;
  tavilyClient: TavilyClient;
  maxDepth: number;
  onProgress?: (progress: ResearchProgress) => void;
}) {
  console.log("=======STARTING-DEEP-RESEARCH=======");

  let queries = research.queries.slice();
  let depth = 1;

  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: maxDepth,
    totalQueries: queries.length,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  while (queries.length > 0) {
    const _queries = queries.slice();
    queries = [];

    await Promise.allSettled(
      _queries.map((query) =>
        limit(async () => {
          console.log("Executing query:", query);
          reportProgress({
            currentQuery: query.query,
            currentDepth: depth,
          });

          try {
            const { results } = await tavilyClient.search(query.query, {
              maxResults: 5,
              searchDepth: "advanced",
            });

            await retry(
              "research:results",
              async () => {
                const system = searchResultsPrompt({
                  research,
                  goal: query.goal,
                  query: query.query,
                  results: results,
                  schema: searchResultsSchema,
                });

                const res = await generateText({
                  model,
                  abortSignal: AbortSignal.timeout(60_000),
                  system,
                  messages: [
                    {
                      role: "assistant",
                      content: "<think>",
                    },
                  ],
                });

                const text = "<think>" + res.text;

                try {
                  const { think, output } = searchResultsParser(text);
                  if (output) {
                    // console.log(output);
                    research.learnings.push(
                      ...output.learnings.map((l) => l.content)
                    );

                    if (depth < maxDepth) {
                      queries.push(...output.followUpQueries);
                    }
                  } else {
                    console.log(text);
                  }
                } catch (error) {
                  console.log("failed parsing");
                  throw error;
                }
              },
              3
            );

            reportProgress({
              completedQueries: progress.completedQueries + 1,
            });
          } catch (error) {
            console.error("Error processing query:", query.query, error);
            reportProgress({
              completedQueries: progress.completedQueries + 1,
            });
          }
        })
      )
    );

    depth++;
    research.queries.push(...queries);

    reportProgress({
      totalQueries: progress.totalQueries + queries.length,
    });
  }

  console.log(research);

  const res = await generateText({
    model,
    system: finalReportPrompt({ research }),
    messages: [
      {
        role: "assistant",
        content: "<think>",
      },
    ],
  });

  console.log("====FINAL REPORT=====");
  console.log("<think>" + res.text);
  const report = res.text.slice(res.text.lastIndexOf("</think>"));
  console.log({ report });
  return report;
}

// export const startDeepResearchAction = action({
//   name: "start-deep-research",
//   schema: researchSchema,
//   async handler(call, ctx) {
//     const research: Research = {
//       ...call.data,
//       learnings: [],
//       status: "in_progress",
//     };

//     console.log({ research });

//     ctx.memory.researches.push(research);

//     startDeepResearch({
//       model,
//       research,
//       tavilyClient,
//       maxDepth: 2,
//     })
//       .then((res) => {
//         ctx.memory.results.push({
//           ref: "action_result",
//           callId: call.id,
//           data: res,
//           name: call.name,
//           timestamp: Date.now(),
//           processed: false,
//         });

//         return agent.run(ctx.id);
//       })
//       .catch((err) => console.error(err));

//     return "Research created!";
//   },
// });
