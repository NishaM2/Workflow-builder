# What the model actually does?

An LLM does exactly one thing: Given a sequence of text, predict what comes next.

- It takes the input text and Predicts what should come next.
- It assigns possibilities to possible next token and selects one
- That token is added to the text and the process repeats until a stop signal
- Everything and LLM does answers, Code, Workflow JSON is essentially this and same process is repeated
- An LLM does not look up information from a database by default
- It learns patterns from huge amount of training data and generates the most plausible continuation 
- The model can generate something that sounds correct but is actually wrong


# TOKENS

The model doesn't work in characters or words. It works in tokens — chunks of roughly 4 characters. "workflow" might be one token. "__NEEDS_INPUT__" might be five. Rough rule: 1 token ≈ 4 characters ≈ 0.75 words.

# Why you care:

- Cost is per token, input and output priced separately
- Speed is per output token — a 2000-token graph takes noticeably longer to generate than a 200-token one
- The context window is measured in tokens

**Node catalog** is sent on every single compile request, Catalog means the instruction file Which describes what that particular node should do. So instead of writing long description you should keep it precise reduce the tokens.

# The context window, and statelessness

- The context window is the maximum total tokens the model can consider at once input plus output.
- The API is completely stateless. The model remembers nothing between calls.
- There is no session there is no conversation stored on the server. 
- If you see a chatbot remember what you said three messages ago, that's because the application is resending the entire conversation history with every single request. The model reads all of it fresh, every time
- For my project whenever a user retry the previous step I must send the current graph in that request.Every time. There is no "the model already knows."

# Messages and roles

You send a list of messages, each with a role:

{
  model: "claude-...",
  system: "You are a workflow compiler. Available node types: ...",
  messages: [
    { role: "user", content: "When a GitHub issue is labeled bug, post to Slack" }
  ]
}

system — instructions, rules, and reference material. Your node catalog and compiler rules go here. It's given more weight than user text.

user — what the person typed.

assistant — means the AI’s previous response. When you want the AI to fix something it generated earlier, you send the original request (user), then the AI’s previous answer (assistant), and then another user message explaining what is wrong and asking it to fix it. This way, the AI can see what it previously created and correct it.

# Temperature

Temperature controls how randomly the next token is picked from the probability distribution.

- Temperature 0 — always pick the highest-probability token. Most consistent.

- Temperature 1 — sample proportionally to probability. More varied, more creative, less reliable.

# Why hallucination happens

Your catalog lists 8 node types. You ask for a workflow that sends an email.

But I never defined send_email. Why did it do that?

- Because it has read enormous amounts of documentation of other workflow tools that exist.
- My eight node catalog is a few hundred tokens fighting against a patterns absorbed from millions of examples. Sometimes the training patterns when 
- The model is not lying or malfunctioning. It's doing exactly what it does — producing plausible text — and plausible isn't the same as correct.
- This is why my entire architecture is validation-first. I cannot prompt hallucination away. I can only make it less likely

# Grounding

Grounding = putting the facts into the context so that the plausible answer and the correct answer are the same thing.

- Node catalog in the system prompt is grounding. Without it, the model invents a workflow format from scratch.
- With it, it's picking from a list you supplied. 
- It's the difference between "write me a workflow" and "write me a workflow using only these eight components, described here."
- This is also why I need to generate the catalog text from Zod schemas rather than handwriting it.
- Handwritten catalog text drifts out of sync with the real schema the moment you change a field, and then im grounding the model in a lie

# Structured outputs — the key technique

- Structured output means instead of simply asking the AI to “give me JSON” and hoping it follows the format, you give the AI a JSON Schema that defines exactly what the output should look like.
- The system then restricts the AI so it can only generate data that follows those rules.
- For example, if type can only be "slack", "http", or "filter", the AI cannot invent "email" as the type
- structured output guarantees the format, but I still need my own validation to check the logic.

# Graph theory

- A graph is nodes plus edges. Your workflow steps are nodes, the arrows between them are edges. Your graph is directed. An edge from A to B means "A then B", not the reverse.
- Adjacency list is how you'll represent connections in code a map from each node to the list of nodes it points to:

// edges: [{source:'a',target:'b'}, {source:'a',target:'c'}, {source:'b',target:'d'}]
const adj = { a: ['b','c'], b: ['d'], c: [], d: [] }

# DAG — Directed Acyclic Graph

- Acyclic means no cycles: you can't follow the arrows and end up back where you started.
- Why this matters? Because a cycle in a workflow graph means infinite execution. A → B → C → A runs forever, burning API calls and money until something crashes.
- So a validator must reject cycles

# Topological sort

Topological sort gives you the correct execution order of workflow nodes and tells you when the workflow has a cycle that makes execution impossible.

how? Because it has a rule which says never run a node before the nodes feeding into it have finished.

- Kahn's algorithm, in plain English:

1. For each node, count how many edges point into it. Call this its in-degree. A trigger node has in-degree 0.
2. Put every node with in-degree 0 into a queue.
3. Pull a node off the queue, add it to your output list. For each node it points to, decrement that node's in-degree by 1. If any drops to 0, push it onto the queue.
4. Repeat until the queue is empty.
5. If your output list contains every node, that's your execution order. If it's shorter, the leftover nodes are in a cycle.

Step 5 is the whole cycle detection. Nodes in a cycle always have someone pointing at them, so their in-degree never reaches 0, so they never enter the queue.
