import { getOAuthConfig } from '../config/oauth.js';
import { buildAnthropicHeaders } from './oauth-client.js';
import { calculateUsageCost, type TelemetryContext } from './telemetry.js';

type MetricsEnabledResponse = {
  metrics_logging_enabled?: boolean;
};

type DataPoint = {
  attributes: Record<string, string>;
  value: number;
  timestamp: string;
};

type Metric = {
  name: string;
  description?: string;
  unit?: string;
  data_points: DataPoint[];
};

type InternalMetricsPayload = {
  resource_attributes: Record<string, string>;
  metrics: Metric[];
};

type SendUsageMetricsOptions = {
  accessToken: string;
  userAgent?: string;
};

type MetricsEnabledCache = {
  enabled: boolean;
  expiresAt: number;
};

const METRICS_CACHE_TTL_MS = 60 * 60 * 1000;

const metricsEnabledCache = new Map<string, MetricsEnabledCache>();

function getPrivacyLevel(): 'default' | 'no-telemetry' | 'essential-traffic' {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'essential-traffic';
  }

  if (process.env.DISABLE_TELEMETRY) {
    return 'no-telemetry';
  }

  return 'default';
}

function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default';
}

function createDataPoint(value: number, attributes: Record<string, string>): DataPoint {
  return {
    attributes,
    value,
    timestamp: new Date().toISOString(),
  };
}

export function createUsageMetricsPayload(
  context: TelemetryContext
): InternalMetricsPayload | null {
  if (!context.response?.success || !context.usage) {
    return null;
  }

  const tokenMetric: Metric = {
    name: 'claude_code.token.usage',
    description: 'Number of tokens used',
    unit: 'tokens',
    data_points: [
      createDataPoint(context.usage.inputTokens, {
        model: context.request.model,
        type: 'input',
      }),
      createDataPoint(context.usage.outputTokens, {
        model: context.request.model,
        type: 'output',
      }),
      createDataPoint(context.usage.cacheReadInputTokens ?? 0, {
        model: context.request.model,
        type: 'cacheRead',
      }),
      createDataPoint(context.usage.cacheCreationInputTokens ?? 0, {
        model: context.request.model,
        type: 'cacheCreation',
      }),
    ],
  };

  const metrics: Metric[] = [tokenMetric];
  const cost = calculateUsageCost(context.request.model, context.usage);
  if (cost !== null) {
    metrics.push({
      name: 'claude_code.cost.usage',
      description: 'Cost of the Claude Code session',
      unit: 'USD',
      data_points: [
        createDataPoint(cost, {
          model: context.request.model,
        }),
      ],
    });
  }

  return {
    resource_attributes: {
      'service.name': 'not-claude-code-emulator',
      'service.version': process.env.npm_package_version ?? 'unknown',
      'os.type': process.platform,
      'os.version': 'unknown',
      'host.arch': process.arch,
      'aggregation.temporality': 'delta',
      'user.customer_type': 'api',
    },
    metrics,
  };
}

async function checkMetricsEnabled(options: SendUsageMetricsOptions): Promise<boolean> {
  const cached = metricsEnabledCache.get(options.accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabled;
  }

  const response = await fetch(
    `${getOAuthConfig().baseApiUrl}/api/claude_code/organizations/metrics_enabled`,
    {
      method: 'GET',
      headers: {
        ...buildAnthropicHeaders(options.accessToken, {
          userAgent: options.userAgent,
        }),
        'content-type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    metricsEnabledCache.set(options.accessToken, {
      enabled: false,
      expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
    });
    return false;
  }

  const data = (await response.json()) as MetricsEnabledResponse;
  const enabled = data.metrics_logging_enabled === true;
  metricsEnabledCache.set(options.accessToken, {
    enabled,
    expiresAt: Date.now() + METRICS_CACHE_TTL_MS,
  });
  return enabled;
}

export async function sendUsageMetrics(
  context: TelemetryContext,
  options: SendUsageMetricsOptions
): Promise<void> {
  if (isTelemetryDisabled()) {
    return;
  }

  const payload = createUsageMetricsPayload(context);
  if (!payload) {
    return;
  }

  try {
    const metricsEnabled = await checkMetricsEnabled(options);
    if (!metricsEnabled) {
      return;
    }

    await fetch(`${getOAuthConfig().baseApiUrl}/api/claude_code/metrics`, {
      method: 'POST',
      headers: {
        ...buildAnthropicHeaders(options.accessToken, {
          userAgent: options.userAgent,
        }),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return;
  }
}

export function _resetMetricsEnabledCacheForTesting(): void {
  metricsEnabledCache.clear();
}
