# AWS Cost Estimator

A [ChatGPT MCP App](https://github.com/modelcontextprotocol/ext-apps) built with [Skybridge](https://docs.skybridge.tech) that estimates monthly AWS costs for common architectures. Describe your stack in natural language — ChatGPT calls the `estimate_architecture` tool and renders an interactive cost breakdown view.

![AWS Cost Estimator](https://github.com/user-attachments/assets/85f7e345-3ff2-4318-a6d0-7d27fc52d25b)

![Cost Estimator Playground](https://github.com/user-attachments/assets/0a52f2c9-7da3-4c2b-9ec9-feff6eeb78e4)

## Features

- **Conversational estimates** — Ask ChatGPT to cost an architecture (e.g. *"EKS medium + RDS small + ALB in ap-south-1"*) and get a structured breakdown.
- **Live AWS Pricing API** — When AWS credentials are configured, prices are fetched from the [AWS Price List API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html). Without credentials, sensible fallback approximations are used.
- **Interactive view** — The `cost-estimator` Skybridge view includes:
  - Architecture graph (React Flow)
  - Per-service cost table with live / estimated badges
  - Bar chart by service
  - Sliders to adjust count and hours/day with live recalculation
- **Supported services** — EKS, MSK, RDS, ALB, S3, CloudFront, ElastiCache, SageMaker, Lambda, API Gateway
- **Regions** — `us-east-1`, `ap-south-1`, `eu-west-1`

## How It Works

Skybridge connects three pieces:

1. **MCP server** (`src/server.ts`) — Registers the `estimate_architecture` tool, resolves pricing, and returns structured output for the LLM and view.
2. **React view** (`src/views/cost-estimator.tsx`) — Renders the interactive UI inside ChatGPT; the human adjusts sliders while the LLM sees updated totals via `data-llm` context.
3. **Pricing layer** (`src/pricing.ts`) — Maps service tiers to instance specs and calls the AWS Pricing SDK, with hardcoded fallbacks when the API is unavailable.

## Prerequisites

- Node.js 24+
- (Optional) AWS credentials for live pricing — `pricing:GetProducts` permission on the IAM principal

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (optional)

Create a `.env` file in the project root:

```env
# Optional — enables live pricing from the AWS Pricing API
AWS_PROFILE=your-profile
# or
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Optional — default is 3000
PORT=4000
```

### 3. Run locally

```bash
npm run dev
```

This starts:

- MCP server at `http://localhost:3000/mcp` (or your `PORT`)
- Skybridge DevTools at `http://localhost:3000`

Use DevTools to invoke `estimate_architecture` and preview the view without ChatGPT.

### 4. Connect to ChatGPT

Expose your local server with a tunnel:

```bash
npm run dev:tunnel
```

Follow the [Skybridge test guide](https://docs.skybridge.tech/quickstart/test-your-app) to connect the MCP endpoint to ChatGPT or another MCP client.

### Example prompts

- *"Estimate monthly cost for a medium EKS cluster, small RDS, and an ALB in ap-south-1."*
- *"What would a large MSK + ElastiCache + Lambda stack cost in us-east-1 running 12 hours a day?"*

## Project Structure

```
├── src/
│   ├── server.ts              # Skybridge MCP server & tool registration
│   ├── pricing.ts             # AWS Pricing API + fallback prices
│   ├── helpers.ts             # useToolInfo / useCallTool hooks
│   ├── index.css              # Tailwind base styles
│   └── views/
│       └── cost-estimator.tsx # Interactive cost breakdown view
├── vite.config.ts
├── alpic.json                 # Alpic deployment config
├── Dockerfile
└── package.json
```

## Deploy

Skybridge apps are infrastructure-agnostic. The simplest path is [Alpic](https://alpic.ai/):

```bash
npm run build
npm run deploy
```

For container-based deployment, use the included `Dockerfile` on any platform that supports MCP servers.

Set AWS credentials in your deployment environment if you want live pricing in production.

## Resources

- [Skybridge Documentation](https://docs.skybridge.tech/)
- [Skybridge API Reference](https://docs.skybridge.tech/api-reference.md)
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk)
- [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Alpic Documentation](https://docs.alpic.ai/)
- [AWS Pricing API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html)
