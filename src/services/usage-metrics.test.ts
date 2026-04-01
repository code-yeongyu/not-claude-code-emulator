import { afterEach, describe, expect, it } from 'bun:test';
import { messagesRoute } from '../routes/messages.js';
import type { TelemetryContext } from './telemetry.js';
import {
  _resetMetricsEnabledCacheForTesting,
  createUsageMetricsPayload,
  sendUsageMetrics,
} from './usage-metrics.js';

const originalFetch = globalThis.fetch;
const originalOAuthBaseUrl = process.env.ANTHROPIC_OAUTH_BASE_URL;
const originalDisableTelemetry = process.env.DISABLE_TELEMETRY;
const originalDisableNonessentialTraffic = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
const originalOAuthToken = process.env.ANTHROPIC_OAUTH_TOKEN;

function createTelemetryContext(): TelemetryContext {
  return {
    requestId: 'req-123',
    request: {
      model: 'claude-sonnet-4-5-20250929',
      stream: false,
      maxTokens: 256,
      hasThinking: false,
    },
    response: {
      success: true,
      statusCode: 200,
      duration: 1500,
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 2000,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 400,
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetMetricsEnabledCacheForTesting();

  if (originalOAuthBaseUrl === undefined) {
    delete process.env.ANTHROPIC_OAUTH_BASE_URL;
  } else {
    process.env.ANTHROPIC_OAUTH_BASE_URL = originalOAuthBaseUrl;
  }

  if (originalDisableTelemetry === undefined) {
    delete process.env.DISABLE_TELEMETRY;
  } else {
    process.env.DISABLE_TELEMETRY = originalDisableTelemetry;
  }

  if (originalDisableNonessentialTraffic === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  } else {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = originalDisableNonessentialTraffic;
  }

  if (originalOAuthToken === undefined) {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_OAUTH_TOKEN = originalOAuthToken;
  }
});

describe('createUsageMetricsPayload', () => {
  it('given successful usage data when creating payload then it returns Claude Code style token and cost metrics', () => {
    const payload = createUsageMetricsPayload(createTelemetryContext());

    expect(payload).not.toBeNull();
    expect(payload?.resource_attributes['service.name']).toBe('not-claude-code-emulator');
    expect(payload?.resource_attributes['aggregation.temporality']).toBe('delta');

    const tokenMetric = payload?.metrics.find(
      (metric) => metric.name === 'claude_code.token.usage'
    );
    expect(tokenMetric).toBeDefined();
    expect(tokenMetric?.unit).toBe('tokens');
    expect(tokenMetric?.data_points.length).toBe(4);

    const inputPoint = tokenMetric?.data_points.find((point) => point.attributes.type === 'input');
    const outputPoint = tokenMetric?.data_points.find(
      (point) => point.attributes.type === 'output'
    );
    const cacheReadPoint = tokenMetric?.data_points.find(
      (point) => point.attributes.type === 'cacheRead'
    );
    const cacheCreationPoint = tokenMetric?.data_points.find(
      (point) => point.attributes.type === 'cacheCreation'
    );

    expect(inputPoint?.attributes.model).toBe('claude-sonnet-4-5-20250929');
    expect(inputPoint?.value).toBe(1000);
    expect(outputPoint?.value).toBe(2000);
    expect(cacheReadPoint?.value).toBe(300);
    expect(cacheCreationPoint?.value).toBe(400);

    const costMetric = payload?.metrics.find((metric) => metric.name === 'claude_code.cost.usage');
    expect(costMetric).toBeDefined();
    expect(costMetric?.unit).toBe('USD');
    expect(costMetric?.data_points[0]?.attributes.model).toBe('claude-sonnet-4-5-20250929');
    expect(costMetric?.data_points[0]?.value).toBeCloseTo(0.03459, 6);
  });

  it('given a date-less sonnet model when creating payload then it still emits the cost metric', () => {
    const telemetryContext = createTelemetryContext();
    telemetryContext.request.model = 'claude-sonnet-4-5';

    const payload = createUsageMetricsPayload(telemetryContext);
    const costMetric = payload?.metrics.find((metric) => metric.name === 'claude_code.cost.usage');

    expect(costMetric).toBeDefined();
    expect(costMetric?.data_points[0]?.attributes.model).toBe('claude-sonnet-4-5');
    expect(costMetric?.data_points[0]?.value).toBeCloseTo(0.03459, 6);
  });

  it('given a sonnet 4.6 model with cache usage when creating payload then it includes cache-aware cost pricing', () => {
    const telemetryContext = createTelemetryContext();
    telemetryContext.request.model = 'claude-sonnet-4-6';

    const payload = createUsageMetricsPayload(telemetryContext);
    const costMetric = payload?.metrics.find((metric) => metric.name === 'claude_code.cost.usage');

    expect(costMetric).toBeDefined();
    expect(costMetric?.data_points[0]?.attributes.model).toBe('claude-sonnet-4-6');
    expect(costMetric?.data_points[0]?.value).toBeCloseTo(0.03459, 6);
  });
});

describe('sendUsageMetrics', () => {
  it('given telemetry is disabled when sending metrics then it skips all network calls', async () => {
    process.env.DISABLE_TELEMETRY = '1';
    let fetchCalled = false;

    globalThis.fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>) => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      },
      { preconnect: originalFetch.preconnect }
    );

    await sendUsageMetrics(createTelemetryContext(), {
      accessToken: 'sk-ant-oat01-test-token',
    });

    expect(fetchCalled).toBe(false);
  });

  it('given metrics are disabled for one token when sending for another token then it re-checks instead of reusing the old result', async () => {
    const fetchCalls: Array<{ url: string; token: string }> = [];

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const authorizationHeader =
          init?.headers && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
            ? init.headers.authorization
            : init?.headers instanceof Headers
              ? (init.headers.get('authorization') ?? '')
              : '';
        fetchCalls.push({ url, token: authorizationHeader });

        if (url.endsWith('/api/claude_code/organizations/metrics_enabled')) {
          if (authorizationHeader === 'Bearer sk-ant-oat01-disabled-token') {
            return new Response(JSON.stringify({ metrics_logging_enabled: false }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ metrics_logging_enabled: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/claude_code/metrics')) {
          return new Response('{}', { status: 200 });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
      { preconnect: originalFetch.preconnect }
    );

    await sendUsageMetrics(createTelemetryContext(), {
      accessToken: 'sk-ant-oat01-disabled-token',
    });
    await sendUsageMetrics(createTelemetryContext(), {
      accessToken: 'sk-ant-oat01-enabled-token',
    });

    expect(
      fetchCalls.filter((call) =>
        call.url.endsWith('/api/claude_code/organizations/metrics_enabled')
      ).length
    ).toBe(2);
    expect(fetchCalls.some((call) => call.url.endsWith('/api/claude_code/metrics'))).toBe(true);
  });

  it('given cache-bearing usage when sending metrics then the emitted cost metric includes cache token pricing', async () => {
    let metricsPayloadBody: string | null = null;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();

        if (url.endsWith('/api/claude_code/organizations/metrics_enabled')) {
          return new Response(JSON.stringify({ metrics_logging_enabled: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/claude_code/metrics')) {
          metricsPayloadBody = String(init?.body ?? '{}');
          return new Response('{}', { status: 200 });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
      { preconnect: originalFetch.preconnect }
    );

    await sendUsageMetrics(createTelemetryContext(), {
      accessToken: 'sk-ant-oat01-test-token',
    });

    if (!metricsPayloadBody) {
      throw new Error('Expected metrics payload to be captured');
    }

    const metricsPayload = JSON.parse(metricsPayloadBody) as {
      metrics?: Array<{ name: string; data_points?: Array<{ value: number }> }>;
    };

    const costMetric = metricsPayload.metrics?.find(
      (metric) => metric.name === 'claude_code.cost.usage'
    );
    expect(costMetric?.data_points?.[0]?.value).toBeCloseTo(0.03459, 6);
  });
});

describe('messagesRoute usage metrics integration', () => {
  it('given a successful messages response when handling the route then it posts usage metrics to Anthropic', async () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.ANTHROPIC_OAUTH_BASE_URL = 'https://api.anthropic.com';

    const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const body = typeof init?.body === 'string' ? init.body : null;
        fetchCalls.push({ url, method, body });

        if (url.endsWith('/api/claude_code/organizations/metrics_enabled')) {
          return new Response(JSON.stringify({ metrics_logging_enabled: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/claude_code/metrics')) {
          return new Response('{}', { status: 200 });
        }

        if (url.endsWith('/v1/messages?beta=true')) {
          return new Response(
            JSON.stringify({
              id: 'msg_123',
              role: 'assistant',
              content: [{ type: 'text', text: 'hello' }],
              model: 'claude-sonnet-4-5-20250929',
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 10,
                output_tokens: 20,
              },
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      { preconnect: originalFetch.preconnect }
    );

    const request = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'localhost',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
    });

    const response = await messagesRoute.request(request);

    expect(response.status).toBe(200);

    const metricsCall = fetchCalls.find((call) => call.url.endsWith('/api/claude_code/metrics'));
    expect(metricsCall).toBeDefined();
    expect(metricsCall?.method).toBe('POST');

    const metricsPayload = JSON.parse(metricsCall?.body ?? '{}') as {
      metrics?: Array<{ name: string }>;
    };
    expect(metricsPayload.metrics?.map((metric) => metric.name)).toContain(
      'claude_code.token.usage'
    );
    expect(metricsPayload.metrics?.map((metric) => metric.name)).toContain(
      'claude_code.cost.usage'
    );
  });

  it('given a streamed usage event split across reads when handling the route then it still posts usage metrics', async () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.ANTHROPIC_OAUTH_BASE_URL = 'https://api.anthropic.com';

    const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const body = typeof init?.body === 'string' ? init.body : null;
        fetchCalls.push({ url, method, body });

        if (url.endsWith('/api/claude_code/organizations/metrics_enabled')) {
          return new Response(JSON.stringify({ metrics_logging_enabled: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/claude_code/metrics')) {
          return new Response('{}', { status: 200 });
        }

        if (url.endsWith('/v1/messages?beta=true')) {
          const encoder = new TextEncoder();
          const bodyStream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: message_start\ndata: {"message": {"usage": {"input_tokens": 10,'
                )
              );
              controller.enqueue(
                encoder.encode(' "output_tokens": 20}}}\n\nevent: message_stop\ndata: {}\n\n')
              );
              controller.close();
            },
          });

          return new Response(bodyStream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      { preconnect: originalFetch.preconnect }
    );

    const request = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'localhost',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
    });

    const response = await messagesRoute.request(request);
    expect(response.status).toBe(200);
    await response.text();

    const metricsCall = fetchCalls.find((call) => call.url.endsWith('/api/claude_code/metrics'));
    expect(metricsCall).toBeDefined();

    const metricsPayload = JSON.parse(metricsCall?.body ?? '{}') as {
      metrics?: Array<{
        name: string;
        data_points?: Array<{ value: number; attributes: Record<string, string> }>;
      }>;
    };
    const tokenMetric = metricsPayload.metrics?.find(
      (metric) => metric.name === 'claude_code.token.usage'
    );
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'input')?.value
    ).toBe(10);
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'output')?.value
    ).toBe(20);
  });

  it('given streamed start and delta usage when delta zeros input fields then it preserves the start values in metrics', async () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.ANTHROPIC_OAUTH_BASE_URL = 'https://api.anthropic.com';

    const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const body = typeof init?.body === 'string' ? init.body : null;
        fetchCalls.push({ url, method, body });

        if (url.endsWith('/api/claude_code/organizations/metrics_enabled')) {
          return new Response(JSON.stringify({ metrics_logging_enabled: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/api/claude_code/metrics')) {
          return new Response('{}', { status: 200 });
        }

        if (url.endsWith('/v1/messages?beta=true')) {
          const encoder = new TextEncoder();
          const bodyStream = new ReadableStream<Uint8Array>({
            start(controller) {
              // given
              controller.enqueue(
                encoder.encode(
                  'event: message_start\ndata: {"message": {"usage": {"input_tokens": 10, "output_tokens": 0, "cache_creation_input_tokens": 4, "cache_read_input_tokens": 3}}}\n\n'
                )
              );
              controller.enqueue(
                encoder.encode(
                  'event: message_delta\ndata: {"usage": {"input_tokens": 0, "output_tokens": 20, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}\n\n'
                )
              );
              controller.close();
            },
          });

          return new Response(bodyStream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      { preconnect: originalFetch.preconnect }
    );

    // when
    const response = await messagesRoute.request(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: 'localhost',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 64,
          stream: true,
          messages: [{ role: 'user', content: 'Say hello' }],
        }),
      })
    );
    await response.text();

    // then
    const metricsCall = fetchCalls.find((call) => call.url.endsWith('/api/claude_code/metrics'));
    expect(metricsCall).toBeDefined();

    const metricsPayload = JSON.parse(metricsCall?.body ?? '{}') as {
      metrics?: Array<{
        name: string;
        data_points?: Array<{ value: number; attributes: Record<string, string> }>;
      }>;
    };
    const tokenMetric = metricsPayload.metrics?.find(
      (metric) => metric.name === 'claude_code.token.usage'
    );
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'input')?.value
    ).toBe(10);
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'cacheCreation')?.value
    ).toBe(4);
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'cacheRead')?.value
    ).toBe(3);
    expect(
      tokenMetric?.data_points?.find((point) => point.attributes.type === 'output')?.value
    ).toBe(20);
  });
});
