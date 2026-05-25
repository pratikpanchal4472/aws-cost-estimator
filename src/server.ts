import { config as dotenvConfig } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { resolvePrice, type Region, type Service, type Tier } from "./pricing.js";

// Load .env relative to this file so CWD doesn't matter in tunnel mode
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../.env"), override: true });

const server = new McpServer(
  {
    name: "aws-cost-estimator",
    version: "0.2.0",
  },
  { capabilities: {} },
).registerTool(
  {
    name: "estimate_architecture",
    description:
      "Estimate monthly AWS costs for one AWS architecture. Call this tool once for the user's current architecture request; do not call it separately for quoted examples, prompt suggestions, or multiple sentences unless the user explicitly asks to compare alternatives. Fetches live pricing from the AWS Pricing API when credentials are available, otherwise uses hardcoded approximations. Returns a per-component cost breakdown and total.",
    inputSchema: {
      description: z
        .string()
        .describe(
          "The single architecture being estimated. If the user provides multiple example prompts, use only the current concrete request unless they ask for a comparison.",
        ),
      components: z.array(
        z.object({
          service: z.enum([
            "EKS",
            "MSK",
            "RDS",
            "ALB",
            "S3",
            "CloudFront",
            "ElastiCache",
            "SageMaker",
            "Lambda",
            "API_Gateway",
          ]),
          tier: z.enum(["small", "medium", "large"]),
          count: z.number().default(1),
          hoursPerDay: z.number().default(24),
        }),
      ).describe("The consolidated service list for this one estimate, not separate example architectures."),
      region: z
        .enum(["us-east-1", "ap-south-1", "eu-west-1"])
        .default("ap-south-1"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true, // may call AWS Pricing API
      destructiveHint: false,
    },
    view: {
      component: "cost-estimator",
      description: "Interactive AWS cost breakdown",
    },
  },
  async ({ description, components, region }) => {
    try {
    // Fetch all component prices in parallel
    const priceResults = await Promise.all(
      components.map((c) =>
        resolvePrice(c.service as Service, c.tier as Tier, region as Region),
      ),
    );

    const costedComponents = components.map((c, i) => {
      const { monthlyCost: baseMonthly, source } = priceResults[i];
      const utilizationFactor = c.hoursPerDay / 24;
      const monthlyCost = +(baseMonthly * utilizationFactor * c.count).toFixed(2);
      return { ...c, monthlyCost, priceSource: source };
    });

    const totalMonthlyCost = +costedComponents
      .reduce((sum, c) => sum + c.monthlyCost, 0)
      .toFixed(2);

    const generatedAt = new Date().toISOString();
    const anyLive = costedComponents.some((c) => c.priceSource === "live");
    const anyApiError = costedComponents.some((c) => c.priceSource === "fallback_api_error");
    const pricingNote = anyLive
      ? "Prices sourced live from the AWS Pricing API."
      : anyApiError
        ? "AWS credentials detected but Pricing API call failed — check that your IAM role has pricing:GetProducts permission. Showing approximate prices."
        : "No AWS credentials detected — prices are approximate. Set AWS_PROFILE (or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) in .env for live pricing.";

    const lines = [
      `## AWS Architecture Cost Estimate`,
      ``,
      `**Region:** ${region}  `,
      `**Generated:** ${generatedAt}`,
      `**Pricing:** ${pricingNote}`,
      ``,
      `### Architecture`,
      description,
      ``,
      `### Cost Breakdown`,
      ``,
      `| Service | Tier | Count | Hours/Day | Monthly Cost | Source |`,
      `|---------|------|-------|-----------|-------------|--------|`,
      ...costedComponents.map(
        (c) =>
          `| ${c.service} | ${c.tier} | ${c.count} | ${c.hoursPerDay} | $${c.monthlyCost.toLocaleString()} | ${c.priceSource} |`,
      ),
      ``,
      `**Total Monthly Cost: $${totalMonthlyCost.toLocaleString()}**`,
    ];

    return {
      structuredContent: {
        components: costedComponents,
        totalMonthlyCost,
        region,
        generatedAt,
        pricingNote,
      },
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[estimate_architecture] handler error:", msg);
      return {
        structuredContent: { error: msg, components: [], totalMonthlyCost: 0, region, generatedAt: new Date().toISOString() },
        content: [{ type: "text" as const, text: `Error estimating costs: ${msg}` }],
      };
    }
  },
);

if (process.env.NODE_ENV === "production") {
  const { default: manifest } = await import("./vite-manifest.js");
  server.setViteManifest(manifest);
}

const runResult = await server.run();

// Fallback for DevTools SPA client-side routes (e.g. /try)
if (process.env.NODE_ENV !== "production") {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const devtoolsDistDir = dirname(fileURLToPath(new URL(require.resolve("@skybridge/devtools"), import.meta.url)));
  server.express.get("*path", (_req: import("express").Request, res: import("express").Response) => {
    res.sendFile(resolve(devtoolsDistDir, "index.html"));
  });
}

export default runResult;

export type AppType = typeof server;
