import { createLlmSet, llmModeLine } from '../src/llm/index.js';
const set = createLlmSet();
console.log(llmModeLine(set.planner));
console.log('configured:', set.planner.configured, '| model:', set.planner.model);
