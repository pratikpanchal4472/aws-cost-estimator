import {
  GetProductsCommand,
  PricingClient,
  type Filter,
} from "@aws-sdk/client-pricing";

export type Tier = "small" | "medium" | "large";
export type Service =
  | "EKS"
  | "MSK"
  | "RDS"
  | "ALB"
  | "S3"
  | "CloudFront"
  | "ElastiCache"
  | "SageMaker"
  | "Lambda"
  | "API_Gateway";
export type Region = "us-east-1" | "ap-south-1" | "eu-west-1";

// ─── fallback prices (us-east-1, monthly, per unit at full utilisation) ───────

export const FALLBACK_PRICING: Record<Service, Record<Tier, number>> = {
  EKS: { small: 73, medium: 292, large: 876 },
  MSK: { small: 180, medium: 540, large: 1440 },
  RDS: { small: 50, medium: 200, large: 720 },
  ALB: { small: 20, medium: 60, large: 150 },
  S3: { small: 5, medium: 23, large: 92 },
  CloudFront: { small: 10, medium: 50, large: 150 },
  ElastiCache: { small: 25, medium: 100, large: 400 },
  SageMaker: { small: 150, medium: 500, large: 2000 },
  Lambda: { small: 5, medium: 20, large: 80 },
  API_Gateway: { small: 10, medium: 35, large: 100 },
};

// ─── region → AWS location name used in Pricing API ──────────────────────────

const LOCATION_NAME: Record<Region, string> = {
  "us-east-1": "US East (N. Virginia)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "eu-west-1": "Europe (Ireland)",
};

// ─── tier → instance spec for each instance-based service ────────────────────
// nodeCount/brokerCount: number of instances per logical unit
// hoursPerMonth: 730 for always-on, used to convert hourly → monthly

const INSTANCE_SPECS: Partial<
  Record<Service, Record<Tier, { serviceCode: string; instanceType: string; units: number; extraMonthly?: number }>>
> = {
  EKS: {
    // EC2 nodes only; EKS cluster fee ($73/mo) folded into extraMonthly
    small:  { serviceCode: "AmazonEC2", instanceType: "t3.medium",  units: 1, extraMonthly: 73 },
    medium: { serviceCode: "AmazonEC2", instanceType: "t3.large",   units: 2, extraMonthly: 73 },
    large:  { serviceCode: "AmazonEC2", instanceType: "m5.xlarge",  units: 3, extraMonthly: 73 },
  },
  RDS: {
    small:  { serviceCode: "AmazonRDS", instanceType: "db.t3.micro",  units: 1 },
    medium: { serviceCode: "AmazonRDS", instanceType: "db.t3.medium", units: 1 },
    large:  { serviceCode: "AmazonRDS", instanceType: "db.r5.large",  units: 1 },
  },
  ElastiCache: {
    small:  { serviceCode: "AmazonElastiCache", instanceType: "cache.t3.micro", units: 1 },
    medium: { serviceCode: "AmazonElastiCache", instanceType: "cache.m5.large", units: 1 },
    large:  { serviceCode: "AmazonElastiCache", instanceType: "cache.r5.large", units: 1 },
  },
  MSK: {
    small:  { serviceCode: "AmazonMSK", instanceType: "m5.large",  units: 2 },
    medium: { serviceCode: "AmazonMSK", instanceType: "m5.xlarge", units: 3 },
    large:  { serviceCode: "AmazonMSK", instanceType: "m5.4xlarge", units: 3 },
  },
  SageMaker: {
    // instanceType field in pricing API has "-Hosting" appended for real-time inference
    small:  { serviceCode: "AmazonSageMaker", instanceType: "ml.m5.large-Hosting",   units: 1 },
    medium: { serviceCode: "AmazonSageMaker", instanceType: "ml.m5.4xlarge-Hosting", units: 1 },
    large:  { serviceCode: "AmazonSageMaker", instanceType: "ml.g5.xlarge-Hosting",  units: 1 },
  },
};

const HOURS_PER_MONTH = 730;

// ─── pricing cache: key="{service}:{tier}:{region}", TTL=1h ──────────────────

interface CacheEntry { price: number; expiresAt: number }
const priceCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60 * 60 * 1000;

function cacheKey(service: Service, tier: Tier, region: Region) {
  return `${service}:${tier}:${region}`;
}

// ─── AWS Pricing client (lazy, only created when credentials are present) ─────

const API_TIMEOUT_MS = 6000;

let client: PricingClient | null = null;

function getClient(): PricingClient | null {
  if (client) return client;
  const hasCredentials =
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_ROLE_ARN;
  if (!hasCredentials) return null;
  // Pricing API is only available in us-east-1
  client = new PricingClient({ region: "us-east-1" });
  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`AWS Pricing API timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ─── extract the first OnDemand price from a GetProducts result ───────────────

function extractHourlyPrice(priceListJson: string): number | null {
  try {
    // AWS SDK may double-encode items as JSON strings — unwrap until we get an object
    let parsed: unknown = JSON.parse(priceListJson);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);

    const item = parsed as {
      terms?: {
        OnDemand?: Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }>;
      };
    };
    const onDemand = item.terms?.OnDemand;
    if (!onDemand) return null;
    for (const term of Object.values(onDemand)) {
      for (const dim of Object.values(term.priceDimensions ?? {})) {
        const usd = dim.pricePerUnit?.USD;
        if (usd) {
          const price = parseFloat(usd);
          if (!isNaN(price) && price > 0) return price;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── build Pricing API filters per service ────────────────────────────────────

function buildFilters(
  serviceCode: string,
  instanceType: string,
  location: string,
): Filter[] {
  const base: Filter[] = [
    { Type: "TERM_MATCH", Field: "location", Value: location },
    { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
    { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
    { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
    { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
    { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
  ];

  if (serviceCode === "AmazonRDS") {
    return [
      { Type: "TERM_MATCH", Field: "location", Value: location },
      { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
      { Type: "TERM_MATCH", Field: "databaseEngine", Value: "PostgreSQL" },
      { Type: "TERM_MATCH", Field: "deploymentOption", Value: "Single-AZ" },
    ];
  }

  if (serviceCode === "AmazonElastiCache") {
    return [
      { Type: "TERM_MATCH", Field: "location", Value: location },
      { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
      { Type: "TERM_MATCH", Field: "cacheEngine", Value: "Redis" },
    ];
  }

  if (serviceCode === "AmazonMSK") {
    return [
      { Type: "TERM_MATCH", Field: "location", Value: location },
      { Type: "TERM_MATCH", Field: "computeFamily", Value: instanceType },
      { Type: "TERM_MATCH", Field: "operation", Value: "RunBroker" },
      { Type: "TERM_MATCH", Field: "group", Value: "Broker" },
    ];
  }

  if (serviceCode === "AmazonSageMaker") {
    return [
      { Type: "TERM_MATCH", Field: "location", Value: location },
      { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType }, // e.g. "ml.m5.large-Hosting"
      { Type: "TERM_MATCH", Field: "component", Value: "Hosting" },
    ];
  }

  // EC2 (used for EKS nodes)
  return base;
}

// ─── fetch a single instance-based monthly price from Pricing API ─────────────

async function fetchInstanceMonthlyPrice(
  serviceCode: string,
  instanceType: string,
  location: string,
): Promise<number | null> {
  const pricingClient = getClient();
  if (!pricingClient) return null;

  try {
    const response = await withTimeout(
      pricingClient.send(
        new GetProductsCommand({
          ServiceCode: serviceCode,
          Filters: buildFilters(serviceCode, instanceType, location),
          MaxResults: 10,
        }),
      ),
      API_TIMEOUT_MS,
    );

    const list = response.PriceList ?? [];
    for (const item of list) {
      const hourly = extractHourlyPrice(typeof item === "string" ? item : JSON.stringify(item));
      if (hourly !== null) return +(hourly * HOURS_PER_MONTH).toFixed(2);
    }
    console.warn(`[pricing] No price found for ${serviceCode} ${instanceType} in ${location}`);
    return null;
  } catch (err) {
    console.error(`[pricing] AWS Pricing API error for ${serviceCode} ${instanceType}:`, err instanceof Error ? err.message : err);
    throw err; // re-throw so resolvePrice can distinguish api-error from no-creds
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface PriceResult {
  monthlyCost: number;
  source: "live" | "fallback_no_creds" | "fallback_api_error";
}

export async function resolvePrice(
  service: Service,
  tier: Tier,
  region: Region,
): Promise<PriceResult> {
  const key = cacheKey(service, tier, region);
  const cached = priceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { monthlyCost: cached.price, source: "live" };
  }

  const spec = INSTANCE_SPECS[service]?.[tier];
  const location = LOCATION_NAME[region];
  const hasCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_ROLE_ARN,
  );

  const regionMultipliers: Record<Region, number> = {
    "us-east-1": 1.0,
    "ap-south-1": 0.9,
    "eu-west-1": 0.95,
  };
  const fallbackPrice = +(FALLBACK_PRICING[service][tier] * regionMultipliers[region]).toFixed(2);

  if (!hasCredentials || !spec) {
    return { monthlyCost: fallbackPrice, source: "fallback_no_creds" };
  }

  try {
    const instanceMonthly = await fetchInstanceMonthlyPrice(spec.serviceCode, spec.instanceType, location);
    if (instanceMonthly !== null) {
      const price = +(instanceMonthly * spec.units + (spec.extraMonthly ?? 0)).toFixed(2);
      priceCache.set(key, { price, expiresAt: Date.now() + CACHE_TTL });
      return { monthlyCost: price, source: "live" };
    }
    // Filters returned no results — fall back but note it was an API issue
    return { monthlyCost: fallbackPrice, source: "fallback_api_error" };
  } catch {
    return { monthlyCost: fallbackPrice, source: "fallback_api_error" };
  }
}
