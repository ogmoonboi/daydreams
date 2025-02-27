/**
 * Basic example demonstrating a simple chat interface using Dreams
 * with a command line interface and Groq's LLM.
 */
import { createGroq } from "@ai-sdk/groq";
import {
  createDreams,
  context,
  render,
  action,
  LogLevel,
  type InferContextMemory,
} from "@daydreamsai/core";
import { cli } from "@daydreamsai/core/extensions";
import { deepResearch } from "./deep-research/research";
import { string, z } from "zod";

export const goalSchema = z.object({
  id: z.string(),
  description: z.string(),
  success_criteria: z.array(z.string()),
  dependencies: z.array(z.string()),
  priority: z.number().min(1).max(10),
  required_resources: z.array(z.string()),
  estimated_difficulty: z.number().min(1).max(10),
});

export const goalPlanningSchema = z.object({
  long_term: z.array(goalSchema),
  medium_term: z.array(goalSchema),
  short_term: z.array(goalSchema),
});

// Initialize Groq client
const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY!,
});

const template = `

Goal: {{goal}} 
Tasks: {{tasks}}
Current Task: {{currentTask}}

<goal_planning_rules>
1. Break down the objective into hierarchical goals
2. Each goal must have clear success criteria
3. Identify dependencies between goals
4. Prioritize goals (1-10) based on urgency and impact
5. short term goals should be given a priority of 10
6. Ensure goals are achievable given the current context
7. Consider past experiences when setting goals
8. Use available game state information to inform strategy

# Return a JSON structure with three arrays:
- long_term: Strategic goals that might take multiple sessions
- medium_term: Tactical goals achievable in one session
- short_term: Immediate actionable goals

# Each goal must include:
- id: Unique temporary ID used in dependencies
- description: Clear goal statement
- success_criteria: Array of specific conditions for completion
- dependencies: Array of prerequisite goal IDs (empty for initial goals)
- priority: Number 1-10 (10 being highest)
- required_resources: Array of resources needed (based on game state)
- estimated_difficulty: Number 1-10 based on past experiences
</goal_planning_rules>
`;

type Goal = z.infer<typeof goalPlanningSchema>;

const goalContexts = context({
  type: "goal-manager",
  schema: z.object({
    id: string(),
  }),

  key({ id }) {
    return id;
  },

  create(state) {
    console.log({ state });

    return {
      goal: null as null | Goal,
      tasks: [],
      currentTask: null,
    };
  },

  render({ memory }) {
    return render(template, {
      goal: memory.goal ?? "NONE",
      tasks: memory?.tasks?.join("\n"),
      currentTask: memory?.currentTask ?? "NONE",
    });
  },
});

type GoalContextMemory = InferContextMemory<typeof goalContexts>;

// Create Dreams agent instance
const agent = createDreams({
  logger: LogLevel.ERROR,
  debugger: async (contextId, keys, data) => {
    const [type, id] = keys;
    await Bun.write(`./logs/tasks/${contextId}/${id}-${type}.md`, data);
  },
  model: groq("deepseek-r1-distill-llama-70b"),
  extensions: [cli, deepResearch],
  context: goalContexts,
  actions: [
    // action({
    //   name: "addTask",
    //   description: "Add a task to the goal",
    //   schema: z.object({ task: z.string() }),
    //   // enabled: ({ context }) => context.type === goalContexts.type,
    //   handler(call, ctx, agent) {
    //     if
    //     const agentMemory = ctx.agentMemory.goal as Goal;
    //     console.log(agentMemory);
    //     agentMemory.long_term.push({
    //       id: "1",
    //       description: call.data.task,
    //       success_criteria: [],
    //       dependencies: [],
    //       priority: 1,
    //       required_resources: [],
    //       estimated_difficulty: 1,
    //     });

    //     return {};
    //   },
    // }),
    action({
      name: "setGoalPlan",
      description: "Set goal plan",
      schema: z.object({ goal: goalPlanningSchema }),
      handler(call, ctx, agent) {
        const agentMemory = ctx.agentMemory as GoalContextMemory;
        console.log({ agentMemory });
        agentMemory.goal = call.data.goal;
        return {
          newGoal: call.data.goal,
        };
      },
    }),
    action({
      name: "updateGoal",
      description:
        "Use this to update a goals state if you think it is complete",
      schema: z.object({ goal: goalSchema }),
      handler(call, ctx, agent) {
        const agentMemory = ctx.agentMemory.goal as Goal;
        const goal = agentMemory.long_term.find(
          (goal) => goal.id === call.data.goal.id
        );

        if (!goal) {
          return { error: "Goal not found" };
        }

        goal.description = call.data.goal.description;
        goal.success_criteria = call.data.goal.success_criteria;
        goal.dependencies = call.data.goal.dependencies;
        goal.priority = call.data.goal.priority;
        goal.required_resources = call.data.goal.required_resources;
        goal.estimated_difficulty = call.data.goal.estimated_difficulty;

        return {
          goal,
        };
      },

      evaluator: {
        name: "validateFetchData",
        prompt: "Ensure the goal is achievable",
        description: "Ensures fetched data meets requirements",

        handler: async (result, ctx, agent) => {
          console.log({ result, ctx, agent });
          const isValid = true;
          return isValid;
        },

        onFailure: async (ctx, agent) => {
          console.log({ ctx, agent });
        },
      },
    }),
  ],
}).start({
  id: "game",
});
